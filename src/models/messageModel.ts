import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
    userId: mongoose.Schema.Types.ObjectId;
    content: string;
    fileUrl: string;
    type: "text" | "image" | "video" | "audio" | "pdf" | "call";
    isRead: boolean;
    isDeleted: boolean;
    createdAt: Date;
}

const MessageSchema = new Schema<IMessage>({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    content: {
        type: String,
        required: true
    },
    fileUrl: {
        type: String, 
    },
    type: {
        type: String,
        enum: ["text", "image", "video", "audio", "pdf", "call"],
        default: "text",
        required: true
    },
    isRead: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Message = mongoose.model<IMessage>("Message", MessageSchema);
export default Message;
