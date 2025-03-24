
import Message from "../models/messageModel";
import Conversation from "../models/conversationModel";
import { Request, Response } from "express";
import CustomRequest from "../types/customRequest";


export default class MessageController {
    static async sendMessage(req: Request, res: Response): Promise<void> {
        const senderId = (req as CustomRequest).userId;
        const { receiverId, content } = req.body;

        if (!senderId || !receiverId || !content) {
            res.status(400).json({
                success: false,
                message: `${!senderId ? "Sender Id" : !receiverId ? "Receiver Id" : "Message"} is required.`,
            });
        }

        try {
            const newMessage = new Message({
                userId: senderId,
                content,
            });

            const savedMessage = await newMessage.save();

            let conversation = await Conversation.findOne({
                members: {
                    $all: [senderId, receiverId],
                    $size: 2
                }
            });

            if (conversation) {
                conversation = await Conversation.findByIdAndUpdate(
                    conversation._id,
                    {
                        $push: { messages: savedMessage._id }
                    },
                    { new: true }
                );
            } else {
                conversation = await Conversation.create({
                    members: [senderId, receiverId],
                    messages: [savedMessage._id]
                });
            }

            res.status(200).json({
                success: true,
                message: "Message sent successfully",
                data: {
                    newMessage: savedMessage,
                    conversation: conversation,
                },
            });
        } catch (error) {
            console.error("Message error:", error);
            res.status(500).json({
                success: false,
                message: "Failed to send message. Please try again."
            });
        }
    }

    static async getMessages(req: Request, res: Response): Promise<void> {
        const senderId = (req as CustomRequest).userId;
        const { receiverId } = req.body;
        if (!senderId || !receiverId) {
            throw new Error("Sender Id or Receiver Id is required.");
        }

        try {
            const conversation = await Conversation.findOne({
                members: {
                    $all: [senderId, receiverId],
                    $size: 2
                }
            }).populate('messages');

            if (!conversation) {
                const newConversation = await Conversation.create({
                    members: [senderId, receiverId],

                });
                res.status(200).json({ success: true, message: "Conversation created successfully", data: newConversation });
            } else {
                res.status(200).json({ success: true, message: "Messages retrieved successfully", data: conversation?.messages });
            }

        } catch (error) {
            console.error("Get messages error:", error);
            res.status(500).json({ success: false, message: "Failed to retrieve messages. Please try again." });
        }
    }

    static async markAsRead(req: Request, res: Response) {
        try {
            const { conversationId, userId } = req.body;
            await Message.updateMany(
                { conversationId, isRead: false, userId: { $ne: userId } },
                { $set: { isRead: true } }
            );
            res.status(200).json({ message: "Messages marked as read" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getUnreadMessagePerUser(req:Request, res: Response){
        const { userId } = req.params;
        try {
            const conversations = await Conversation.find({ members: userId })
                .populate({
                    path: "messages",
                    model: "Message",
                    select: "isRead userId" 
                });
    
            const unreadCounts = conversations.map(convo => ({
                conversationId: convo._id,
                unreadCount: convo.messages.filter((msg: any) => !msg.isRead && msg.userId.toString() !== userId).length
            }));
    
            res.status(200).json(unreadCounts);
        } catch (error) {
            console.error("Error fetching unread messages:", error);
            res.status(500).json({ error: "Error fetching unread messages count" });
        }
    }

}