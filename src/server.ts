import express, { Request, Response } from "express";
import connectDB from "./config/database";
import * as dotenv from 'dotenv';
import { Server } from "socket.io";
import http from "http";
import path from 'path';
import cors from 'cors';
import jwt from "jsonwebtoken";
import router from "./routes/routes";
import Message from "./models/messageModel";
import Conversation from "./models/conversationModel";
import mongoose from "mongoose";
import User from "./models/userModel";
import * as mediasoup from "mediasoup";
import { v2 as cloudinary } from "cloudinary";
import uploadCloudnary from "./utils/cloudinary";

dotenv.config();
const app = express();
const port = process.env.PORT ?? 8080;
const server = http.createServer(app);
const userSockets = new Map<string, string>();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  maxHttpBufferSize: 1e8
});

app.use(express.json({ limit: "1000mb" }));
app.use(express.urlencoded({ extended: true, limit: "1000mb" }));
app.use(cors());
app.use("/", router);

app.post("/upload", uploadCloudnary.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const base64String = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  const result = await cloudinary.uploader.upload(base64String,{folder: "uploads"});
  const fileUrl = result.secure_url;
  res.status(200).json({ fileUrl });
});


let worker: mediasoup.types.Worker;
let routerWorker: mediasoup.types.Router;
let transports: any = {};
let producers: { [key: string]: mediasoup.types.Producer } = {};
let consumers: { [key: string]: mediasoup.types.Consumer } = {};
let peers: { [key: string]: { transports: string[], producers: string[], consumers: string[] } } = {};

async function createMediasoupWorker() {
  worker = await mediasoup.createWorker();

  routerWorker = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000
      }
    ]
  });
}
createMediasoupWorker();



io.use((socket, next) => {
  const token: any = socket.handshake.query.token;
  if (!token) {
    return next(new Error("Authentication error"));
  }
  try {
    const decoded = jwt.verify(token, process.env.secretKey!) as { userId: string };
    socket.data.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});


io.on("connection", async (socket) => {
  const userId = socket.data.userId;
  if (!userId) {
    socket.disconnect();
    return;
  }

  console.log(`User connected: ${userId} (Socket ID: ${socket.id})`);
  await User.findByIdAndUpdate(userId, { isOnline: true });
  userSockets.set(userId, socket.id);

  socket.on("joinConversation", async (conversationId) => {
    socket.join(conversationId);
    console.log(`User ${socket.data.userId} joined conversation: ${conversationId}`);
  });

  socket.on("sendMessage", async (messageData: { userId: any, conversationId: mongoose.Schema.Types.ObjectId, content: string, fileUrl?: string, type: string }) => {

    const newMessage = new Message({
      userId: messageData.userId._id,
      content: messageData.content || messageData.type,
      fileUrl: messageData.fileUrl || "",
      type: messageData.type,
      createdAt: new Date(),
    });

    await newMessage.save();

    const conversation = await Conversation.findById(messageData.conversationId);
    if (conversation) {
      conversation.messages.push(newMessage._id as any);
      await conversation.save();
      console.log("Message saved to conversation:", conversation._id);

      io.to(messageData.conversationId.toString()).emit("receiveMessage", {
        ...newMessage.toObject(),
        userId: messageData.userId,
        conversationId: messageData.conversationId,
      });

      conversation.members.forEach((member) => {
        if (userSockets.has(member.toString()) && member.toString() !== messageData.userId._id.toString()) {
          io.to(userSockets.get(member.toString())!).emit("receiveMessage", {
            ...newMessage.toObject(),
            conversationId: messageData.conversationId,
          });
        }
      });
    } else {
      console.log("Conversation not found");
    }
  });

  socket.on("typing", (conversationId: mongoose.Schema.Types.ObjectId | string, userId: mongoose.Schema.Types.ObjectId) => {
    socket.broadcast.to(conversationId as string).emit("userTyping", { userId, isTyping: true });
  });

  socket.on("stopTyping", (conversationId: mongoose.Schema.Types.ObjectId | string, userId: mongoose.Schema.Types.ObjectId) => {
    socket.broadcast.to(conversationId as string).emit("userTyping", { userId, isTyping: false });
  });

  socket.on("markMessagesRead", async (conversationId: mongoose.Schema.Types.ObjectId, userId: mongoose.Schema.Types.ObjectId) => {
    try {
      const conversation = await Conversation.findById(conversationId).populate("messages");
      if (!conversation) return;
      await Message.updateMany(
        {
          _id: { $in: conversation.messages },
          isRead: false,
          userId: { $ne: userId }
        },
        { $set: { isRead: true } }
      );
      io.to(conversationId.toString()).emit("messagesMarkedRead", { conversationId, userId });
      console.log(`Messages marked as read in conversation: ${conversationId}`);
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  });

  socket.on("callUser", ({ userToCall, signalData, from, callType }) => {
    const socketId = userSockets.get(userToCall);
    if (socketId) io.to(socketId).emit("incomingCall", { from, offer: signalData, callType });
  });


  socket.on("answerCall", (data) => {
    const socketId = userSockets.get(data.to);
    if (socketId) {
      io.to(socketId).emit("callAccepted", { answer: data.signal });
    } else {
      console.error("Caller not found for answer forwarding.");
    }
  });

  socket.on("iceCandidate", ({ userToCall, candidate }) => {
    const socketId = userSockets.get(userToCall);
    if (socketId) {
        io.to(socketId).emit("iceCandidate", candidate);
    }
});

  socket.on("disconnect", async () => {
    console.log(`User disconnected: ${userId} (Socket ID: ${socket.id})`);
    await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });

    userSockets.delete(userId);
    setTimeout(() => {
      if (!userSockets.has(userId)) {
        console.log(`User ${userId} did not reconnect.`);
      }
    }, 5000);

    if (transports[socket.id])
      delete transports[socket.id];
    if (producers[socket.id])
      delete producers[socket.id];
    if (consumers[socket.id])
      delete consumers[socket.id];
  });

  socket.on("createTransport", async (_, callback) => {
    try {
      const transport = await routerWorker.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: "192.168.4.29" }],
        enableUdp: true,
        enableTcp: true,
      });
      console.log(`Transport created for socket ${socket.id}:`, transport.id);
      if (!peers[socket.id]) {
        peers[socket.id] = { transports: [], producers: [], consumers: [] };
      }

      peers[socket.id].transports.push(transport.id);
      transports[transport.id] = transport;

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (error) {
      console.error("Error creating transport:", error);
      callback({ error: "Failed to create transport" });
    }
  });

  socket.on("connectTransport", async ({ transportId, dtlsParameters }, callback) => {
    try {
      console.log(`Connecting transport: ${transportId} for socket ${socket.id}`);

      const transport = transports[transportId];

      if (!transport) {
        return callback({ error: "Transport not found" });
      }

      if (transport.connected) {
        console.log(`Transport ${transportId} is already connected!`);
        return callback({ success: true });
      }

      await transport.connect({ dtlsParameters });
      transport.connected = true;

      callback({ success: true });
    } catch (error) {
      console.error("Error connecting transport:", error);
      callback({ error: "Failed to connect transport" });
    }

  });

  socket.on("produce", async ({ kind, rtpParameters }, callback) => {
    console.log('Received rtpParameters:', rtpParameters);

    if (!rtpParameters || Object.keys(rtpParameters).length === 0) {
      return callback({ error: "Invalid rtpParameters" });
    }
    try {
      // const transport = transports[socket.id];
      const transport: any = Object.values(transports).find((t: any) => t.appData?.socketId === socket.id);

      if (transport) {
        const producer = await transport.produce({ kind, rtpParameters });
        producers[producer.id] = producer;
        callback({ id: producer.id });
      } else {
        callback({ error: "Transport not found" });
      }
    } catch (error) {
      console.error("Error producing:", error);
      callback({ error: "Failed to produce" });
    }
  });

  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    try {
      if (!routerWorker.canConsume({ producerId, rtpCapabilities })) {
        callback({ error: "Cannot consume" });
        return;
      }

      const transport = transports[socket.id];
      if (transport) {
        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: false,
        });

        consumers[consumer.id] = consumer;
        callback({
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } else {
        callback({ error: "Transport not found" });
      }
    } catch (error) {
      console.error("Error consuming:", error);
      callback({ error: "Failed to consume" });
    }
  });

  socket.on('joinCall', (groupId) => {
    socket.join(groupId);
    io.to(groupId).emit('newParticipant', {
      userId: socket.data.userId,
      audioProducerId: socket.data.audioProducerId,
      videoProducerId: socket.data.videoProducerId,
    });
  });

  socket.on('getParticipants', (groupId, callback) => {
    const participants = Array.from(io.sockets.adapter.rooms.get(groupId) || []).map((socketId) => {
      const participantSocket = io.sockets.sockets.get(socketId);
      return {
        userId: participantSocket?.data.userId,
        audioProducerId: participantSocket?.data.audioProducerId,
        videoProducerId: participantSocket?.data.videoProducerId,
      };
    });

    callback({ participants });
  });

  socket.on('getRouterRtpCapabilities', (callback) => {
    console.log('Getting router rtp capabilities', callback);

    if (!routerWorker) {
      if (callback && typeof callback === 'function') {
        callback({ error: 'Router not initialized' });
      }
      return;
    }

    if (callback && typeof callback === 'function') {
      callback({ rtpCapabilities: routerWorker.rtpCapabilities });
    } else {
      console.error('Callback is not a function');
    }
  });

});

app.use('/uploads', express.static(path.join(__dirname, '/uploads')));

connectDB().then(() => {
  server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}).catch((error) => {
  console.log("Error starting server:", error.message);
});
