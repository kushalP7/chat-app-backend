import Message from "../models/messageModel";

export default class MessageService{
 public static async deleteMessageById(messageId: string, userId: string) {
    const message = await Message.findById(messageId);

    if (!message) {
        throw new Error("Message not found");
    }

    if (message.userId.toString() !== userId) {
        throw new Error("Unauthorized to delete this message");
    }

    await Message.findByIdAndDelete(messageId);
    return { success: true, message: "Message deleted successfully" };
 }
}
