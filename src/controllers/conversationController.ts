import { Request, Response } from "express";
import Conversation from "../models/conversationModel";
import CustomRequest from "../types/customRequest";
import mongoose from "mongoose";

export default class ConversationController {
    static async getUserConversations(req: Request, res: Response) {
        try {
            const userId = new mongoose.Types.ObjectId((req as CustomRequest).userId);
            if (!userId) {
                return res.status(400).json({ success: false, message: "User ID is required." });
            }

            const conversations = await Conversation.aggregate([
                { $match: { members: userId, isGroup: false } },

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
                                if: {
                                    $gt: [{ $size: "$messagesData" }, 0]
                                },
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
                                            {
                                                $ne: ["$$msg.userId", userId]
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                },
                {
                    $match: {
                        lastMessage: { $ne: null }
                    }
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
                                        cond: { $eq: ["$$member._id", userId] }
                                    }
                                },
                                0
                            ]
                        },
                        receiver: {
                            $arrayElemAt: [
                                {
                                    $filter: {
                                        input: "$membersData",
                                        as: "member",
                                        cond: { $ne: ["$$member._id", userId] }
                                    }
                                },
                                0
                            ]
                        },
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
                {
                    $sort: {
                        "timestamp": -1
                    }
                }
            ]);
            res.status(200).json({ success: true, data: conversations });
        } catch (error) {
            console.error("Error fetching conversations:", error);
            res.status(500).json({ success: false, message: "Failed to get conversations." });
        }
    }


    static async getMessagesByConversationId(req: Request, res: Response): Promise<void> {
        try {
            const { conversationId } = req.params;

            if (!conversationId) {
                throw new Error("Conversation ID is required");
            }

            // const conversation = await Conversation.findById(conversationId).populate('messages');

            const conversation = await Conversation.findById(conversationId)
                .populate({
                    path: 'messages',
                    populate: {
                        path: 'userId',
                        select: 'username email avatar isOnline lastSeen'
                    }
                });

            if (!conversation) {
                throw new Error("Conversation not found");
            }

            res.status(200).json({ success: true, message: "Messages retrieved successfully", data: conversation.messages });
        } catch (error) {
            console.error("Get messages error:", error);
            res.status(500).json({ success: false, message: "Failed to retrieve messages. Please try again." });
        }
    }

    static async createOrGetConversation(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as CustomRequest).userId;
            const receiverId = req.body.receiverId;

            let conversation = await Conversation.findOne({
                members: { $all: [userId, receiverId] },
                isGroup: false,
            });

            if (!conversation) {
                conversation = new Conversation({
                    members: [userId, receiverId],
                    messages: [],
                    timestamp: new Date(),
                });
                await conversation.save();
            }

            res.json({ conversationId: conversation._id });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    static async createGroupConversation(req: Request, res: Response): Promise<void> {
        const { members, groupName, groupDescription } = req.body;
        const groupAvatar = req.file;
        const groupAdmin = (req as CustomRequest).userId;

        try {
            const jsonMember = JSON.parse(members);
            if (!jsonMember.includes(groupAdmin)) {
                jsonMember.push(groupAdmin);
            }
            const newConversation = new Conversation({
                members: jsonMember,
                isGroup: true,
                groupName,
                groupAdmin,
                groupAvatar: groupAvatar?.path.replace(/^src[\\\/]/, ''),
                groupDescription,
            });
            if (!groupName || !members || members.length < 2) throw new Error('A group must have a name and at least 2 members')
            const savedConversation = await newConversation.save();

            res.status(201).json({ status: true, data: savedConversation, message: 'Group Conversation created Successfully' });
        } catch (error) {
            res.status(500).json({ status: false, data: null, message: [error.message].join(', ') });

        }
    }

    static async addMemberInGroup(req: Request, res: Response): Promise<void> {
        try {
            const { userId } = req.body;
            const currentUserId = (req as CustomRequest).userId;
            const conversation = await Conversation.findById(req.params.id);

            if (!conversation) throw new Error('Group conversation not found');

            if (!conversation.isGroup) throw new Error('This is not a group conversation');

            if (conversation?.groupAdmin?.toString() !== currentUserId) throw new Error('Only the group admin can add members');

            if (conversation.members.includes(userId)) throw new Error('User is already a member of this group');

            conversation.members.push(userId);
            await conversation.save();

            res.status(200).json({ status: true, data: conversation, message: 'Member Added Successfully' });

        } catch (error) {
            res.status(500).json({ status: false, data: null, message: [error.message].join(', ') });

        }
    }

    static async getUserGroupsConversations(req: Request, res: Response) {
        try {
            const userId = new mongoose.Types.ObjectId((req as CustomRequest).userId);

            if (!userId) {
                return res.status(400).json({ success: false, message: "User ID is required." });
            }

            const conversations = await Conversation.aggregate([
                {
                    $match: {
                        members: userId,
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
                                            { $ne: ["$$msg.userId", userId] }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                },
                // {
                //     $match: {
                //         lastMessage: { $ne: null }
                //     }
                // },
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

            res.status(200).json({ success: true, data: conversations, message: 'Grop chats get Successfully' });

        } catch (error) {
            res.status(500).json({ status: false, data: null, message: [error.message].join(', ') });
        }
    }

    static async getGroupInfo(req: Request, res: Response) {
        try {
            const conversationId = req.params.id;

            const conversation = await Conversation.aggregate([
                {
                    $match: { _id: new mongoose.Types.ObjectId(conversationId) }
                },
                {
                    $match: { isGroup: true }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'groupAdmin',
                        foreignField: '_id',
                        as: 'groupAdminDetails'
                    }
                },
                {
                    $unwind: {
                        path: '$groupAdminDetails',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'members',
                        foreignField: '_id',
                        as: 'membersDetails'
                    }
                },
                {
                    $project: {
                        groupName: 1,
                        groupAdmin: '$groupAdminDetails',
                        groupAvatar: 1,
                        groupDescription: 1,
                        members: 1,
                        membersDetails: 1,
                        timestamp: 1
                    }
                }
            ]);


            if (!conversation || conversation.length === 0) {
                throw new Error('Group conversation not found');
            }


            res.status(200).json({ status: true, data: conversation[0], message: 'Data get Successfully' });

        } catch (error) {
            res.status(500).json({ status: false, data: null, message: [error.message].join(', ') });

        }
    }


}
