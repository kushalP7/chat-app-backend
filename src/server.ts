import express, { Request, Response } from "express";
import connectDB from "./config/database";
import * as dotenv from 'dotenv';
import { Server } from "socket.io";
import http from "http";
import path from 'path';
import cors from 'cors';
import router from "./routes/routes";
import Message from "./models/messageModel";
import Conversation from "./models/conversationModel";
import mongoose from "mongoose";
import User, { IUser } from "./models/userModel";
import { v2 as cloudinary } from "cloudinary";
import uploadCloudnary from "./utils/cloudinary";
import { JwtUtills } from "./utils/jwtUtiils";
import { logger } from "./utils/logger";

dotenv.config();
const app = express();
const port = process.env.PORT ?? 8080;
const server = http.createServer(app);
const userSockets = new Map<string, string>();
const groupCalls = new Map<string, Set<string>>();


const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  maxHttpBufferSize: 1e8
});

app.use(logger);
app.use(express.json({ limit: "1000mb" }));
app.use(express.urlencoded({ extended: true, limit: "1000mb" }));
app.use(cors());
app.use("/", router);

app.post("/upload", uploadCloudnary.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const mimeType = req.file.mimetype;
    let resourceType: "image" | "video" | "auto" | "raw" = "auto";
    if (mimeType.startsWith("video/")) {
      resourceType = "video";
    } else if (mimeType.startsWith("image/")) {
      resourceType = "image";
    } else if (mimeType.startsWith("application/pdf")) {
      resourceType = "raw";
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload a video or image." });
    }
    const base64String = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    const result = await cloudinary.uploader.upload(base64String, {
      folder: "uploads",
      resource_type: resourceType,
    });
    const fileUrl = result.secure_url;
    res.status(200).json({ fileUrl });
  } catch (error) {
    res.status(500).json({ status: false, data: null, message: [error.message].join(', ') });
  }
});

io.use((socket, next) => {
  const token = socket.handshake.query.token;
  if (!token) {
    return next(new Error("Authentication error"));
  }
  try {
    const decoded = JwtUtills.verifyToken(token as string) as { userId: string };
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

  socket.on("sendMessage", async (messageData: { user: IUser, conversationId: mongoose.Schema.Types.ObjectId, content: string, fileUrl?: string, type: string }) => {

    const newMessage = new Message({
      userId: messageData.user._id,
      content: messageData.content || messageData.type,
      fileUrl: messageData.fileUrl || "",
      type: messageData.type,
      createdAt: new Date(),
    });

    await newMessage.save();

    const conversation = await Conversation.findById(messageData.conversationId);
    if (conversation) {
      conversation.messages.push(newMessage._id as mongoose.Schema.Types.ObjectId);
      await conversation.save();
      console.log("Message saved to conversation:", conversation._id);

      io.to(messageData.conversationId.toString()).emit("receiveMessage", {
        ...newMessage.toObject(),
        user: messageData.user,
        conversationId: messageData.conversationId,
      });

      conversation.members.forEach((member) => {
        if (userSockets.has(member.toString()) && member.toString() !== messageData.user._id.toString()) {
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
    if (socketId) {
      io.to(socketId).emit("incomingCall", { from, offer: signalData, callType, to: userToCall });
    }
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

  socket.on('call-ended', ({ to }) => {
    socket.to(to).emit('callEnded');
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
  });
  
  socket.on('startGroupCall', ({ groupId, userId }) => {
    if (!groupCalls.has(groupId)) {
      groupCalls.set(groupId, new Set());
    }
    groupCalls.get(groupId)?.add(userId);
    
    socket.to(groupId).emit("groupCallStarted", {
      groupId,
      initiator: socket.data.userId,
      activeGroupCall: true,
    });
    console.log(`Group call started for ${groupId} by ${socket.data.userId}`);
  });
  
  socket.on('joinGroupCall', ({ groupId, userId }) => {
    if (groupCalls.has(groupId)) {
      groupCalls.get(groupId)?.add(userId);
      
      groupCalls.get(groupId)?.forEach(participantId => {
        if (participantId !== userId) {
          const participantSocketId = userSockets.get(participantId);
          if (participantSocketId) {
            io.to(participantSocketId).emit('groupCallParticipantJoined', { groupId, userId });
          }
        }
      });
    }
  });
  
  socket.on('leaveGroupCall', ({ groupId, userId }) => {
    if (groupCalls.has(groupId)) {
      groupCalls.get(groupId)?.delete(userId);
      
      groupCalls.get(groupId)?.forEach(participantId => {
        const participantSocketId = userSockets.get(participantId);
        if (participantSocketId) {
          io.to(participantSocketId).emit('groupCallParticipantLeft', { groupId, userId });
        }
      });
      
      if (groupCalls.get(groupId)?.size === 0) {
        groupCalls.delete(groupId);
      }
    }
  });
  
  socket.on('groupCallOffer', ({ groupId, toUserId, offer }) => {
    const toSocketId = userSockets.get(toUserId);
    if (toSocketId) {
      io.to(toSocketId).emit('groupCallOffer', { groupId, fromUserId: socket.data.userId, offer });
    }
  });
  
  socket.on('groupCallAnswer', ({ groupId, toUserId, answer }) => {
    const toSocketId = userSockets.get(toUserId);
    if (toSocketId) {
      io.to(toSocketId).emit('groupCallAnswer', { groupId, fromUserId: socket.data.userId, answer });
    }
  });
  
  socket.on('groupCallIceCandidate', ({ groupId, toUserId, candidate }) => {
    const toSocketId = userSockets.get(toUserId);
    if (toSocketId) {
      io.to(toSocketId).emit('groupCallIceCandidate', { groupId, fromUserId: socket.data.userId, candidate });
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
