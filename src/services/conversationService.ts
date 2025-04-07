import mongoose from "mongoose";
import Conversation from "../models/conversationModel";
import { v2 as cloudinary } from "cloudinary";

export default class ConversationService {
    public static async getUserConversations(userId: mongoose.Types.ObjectId) {

        const objectId = new mongoose.Types.ObjectId(userId);

        const conversations = await Conversation.aggregate([
            { $match: { members: objectId, isGroup: false } },

            {
                $lookup: {
                    from: "users",
                    localField: "members",
                    foreignField: "_id",
                    as: "membersData",
                },
            },
            {
                $lookup: {
                    from: "messages",
                    localField: "messages",
                    foreignField: "_id",
                    as: "messagesData",
                },
            },
            {
                $addFields: {
                    lastMessage: {
                        $cond: {
                            if: { $gt: [{ $size: "$messagesData" }, 0] },
                            then: {
                                $arrayElemAt: [
                                    {
                                        $sortArray: {
                                            input: "$messagesData",
                                            sortBy: { createdAt: -1 },
                                        },
                                    },
                                    0,
                                ],
                            },
                            else: null,
                        },
                    },
                    unreadCount: {
                        $size: {
                            $filter: {
                                input: "$messagesData",
                                as: "msg",
                                cond: {
                                    $and: [
                                        { $eq: ["$$msg.isRead", false] },
                                        { $ne: ["$$msg.userId", objectId] },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
            {
                $match: {
                    lastMessage: { $ne: null },
                },
            },
            {
                $project: {
                    _id: 1,
                    unreadCount: 1,
                    sender: {
                        $arrayElemAt: [
                            {
                                $filter: {
                                    input: "$membersData",
                                    as: "member",
                                    cond: { $eq: ["$$member._id", objectId] },
                                },
                            },
                            0,
                        ],
                    },
                    receiver: {
                        $arrayElemAt: [
                            {
                                $filter: {
                                    input: "$membersData",
                                    as: "member",
                                    cond: { $ne: ["$$member._id", objectId] },
                                },
                            },
                            0,
                        ],
                    },
                    lastMessage: {
                        _id: "$lastMessage._id",
                        content: "$lastMessage.content",
                        type: "$lastMessage.type",
                        isRead: "$lastMessage.isRead",
                        createdAt: "$lastMessage.createdAt",
                    },
                    timestamp: { $ifNull: ["$lastMessage.createdAt", "$timestamp"] },
                },
            },
            {
                $sort: {
                    timestamp: -1,
                },
            },
        ]);

        return conversations;
    }

    public static async getMessagesByConversationId(conversationId: string) {
        if (!conversationId) {
            throw new Error("Conversation ID is required");
        }
        const conversation = await Conversation.findById(conversationId).populate({
            path: "messages",
            populate: {
                path: "userId",
                select: "username email avatar isOnline lastSeen",
            },
        });

        if (!conversation) {
            throw new Error("Conversation not found");
        }
        return conversation;
    }

    public static async createOrGetConversation(userId: string, receiverId: string) {

        let conversation = await Conversation.findOne({ members: { $all: [userId, receiverId] }, isGroup: false, });

        if (!conversation) {
            conversation = new Conversation({ members: [userId, receiverId], messages: [], timestamp: new Date(), });
            await conversation.save();
        }
        return conversation;
    }

    public static async createGroupConversation(groupAdmin: string, members: string, groupName: string, groupDescription: string, file: Express.Multer.File | undefined) {
        if (!file) {
            throw new Error("No file uploaded");
        }
        const base64String = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
        const result = await cloudinary.uploader.upload(base64String, { folder: "uploads" });

        const jsonMember = JSON.parse(members);
        if (!jsonMember.includes(groupAdmin)) {
            jsonMember.push(groupAdmin);
        }

        if (!groupName || members.length < 2) throw new Error("A group must have a name and at least 2 members");

        const newConversation = new Conversation({
            members: jsonMember,
            isGroup: true,
            groupName,
            groupAdmin,
            groupAvatar: result.secure_url,
            groupDescription,
        });

        const savedConversation = await newConversation.save();
        return savedConversation;
    }

    public static async addMemberInGroup(conversationId: string, currentUserId: string, userId: mongoose.Schema.Types.ObjectId) {
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) throw new Error("Group conversation not found");

        if (!conversation.isGroup) throw new Error("This is not a group conversation");

        if (conversation?.groupAdmin?.toString() !== currentUserId) throw new Error("Only the group admin can add members");

        if (conversation.members.includes(userId)) throw new Error("User is already a member of this group");

        conversation.members.push(userId);
        await conversation.save();
        return conversation;
    }

    public static async getUserGroupsConversations(userId: string) {

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const conversations = await Conversation.aggregate([
            {
                $match: {
                    members: userObjectId,
                    isGroup: true
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "members",
                    foreignField: "_id",
                    as: "membersData"
                }
            },
            {
                $lookup: {
                    from: "messages",
                    localField: "messages",
                    foreignField: "_id",
                    as: "messagesData"
                }
            },
            {
                $addFields: {
                    lastMessage: {
                        $cond: {
                            if: { $gt: [{ $size: "$messagesData" }, 0] },
                            then: {
                                $arrayElemAt: [
                                    {
                                        $sortArray: {
                                            input: "$messagesData",
                                            sortBy: { createdAt: -1 }
                                        }
                                    },
                                    0
                                ]
                            },
                            else: null
                        }
                    },
                    unreadCount: {
                        $size: {
                            $filter: {
                                input: "$messagesData",
                                as: "msg",
                                cond: {
                                    $and: [
                                        { $eq: ["$$msg.isRead", false] },
                                        { $ne: ["$$msg.userId", userObjectId] }
                                    ]
                                }
                            }
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 1,
                    groupName: 1,
                    groupAvatar: 1,
                    groupDescription: 1,
                    groupAdmin: 1,
                    members: "$membersData",
                    unreadCount: 1,
                    lastMessage: {
                        _id: "$lastMessage._id",
                        content: "$lastMessage.content",
                        type: "$lastMessage.type",
                        isRead: "$lastMessage.isRead",
                        createdAt: "$lastMessage.createdAt"
                    },
                    timestamp: {
                        $ifNull: ["$lastMessage.createdAt", "$timestamp"]
                    }
                }
            },
            { $sort: { "timestamp": -1 } }
        ]);
        return conversations;
    }

    public static async getGroupInfo(conversationId: string) {
        const conversation = await Conversation.aggregate([
            {
                $match: { _id: new mongoose.Types.ObjectId(conversationId) }
            },
            {
                $match: { isGroup: true }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "groupAdmin",
                    foreignField: "_id",
                    as: "groupAdminDetails"
                }
            },
            {
                $unwind: {
                    path: "$groupAdminDetails",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "members",
                    foreignField: "_id",
                    as: "membersDetails"
                }
            },
            {
                $project: {
                    groupName: 1,
                    groupAdmin: "$groupAdminDetails",
                    groupAvatar: 1,
                    groupDescription: 1,
                    members: 1,
                    membersDetails: 1,
                    timestamp: 1
                }
            }
        ]);

        if (!conversation || conversation.length === 0)
            throw new Error("Group conversation not found");
        return conversation.shift();
    }

}
