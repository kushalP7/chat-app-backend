import { Request, Response } from "express";
import MessageService from "../services/message.service";
import CustomRequest from "../types/customRequest";

export default class MessageController {
    public static async deleteMessage(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const userId = (req as CustomRequest).userId;

            const result = await MessageService.deleteMessageById(id, userId!);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    };
}
