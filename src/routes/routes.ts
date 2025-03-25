import { Router } from "express";
import verifyToken from "../middleware/authMiddleware";
import UserController from "../controllers/userController";
import MessageController from "../controllers/messageController";
import ConversationController from "../controllers/conversationController";
import uploadCloudnary from "../utils/cloudinary";

const router = Router();

router.post('/web/user/register', uploadCloudnary.single('image'), UserController.creatUser);
router.post('/web/user/login', UserController.loginUser);
router.get('/web/users', verifyToken, UserController.getAllUser);
router.delete('/web/deleteUser/:id', verifyToken, UserController.deleteUser);
router.get('/web/user/:userId', verifyToken, UserController.getUserById);
router.get('/web/users/except-current', verifyToken, UserController.getAllUsersExceptCurrentUser);

router.post('/sendMessage', verifyToken, MessageController.sendMessage)
router.post('/getMessages', verifyToken, MessageController.getMessages)
router.post('/markMessagesRead', verifyToken, MessageController.markAsRead);
router.get('/unread-messages/:userId', verifyToken, MessageController.getUnreadMessagePerUser);

router.get('/conversations', verifyToken, ConversationController.getUserConversations);
router.post('/conversations', verifyToken, ConversationController.createOrGetConversation);
router.get('/messages/:conversationId', verifyToken, ConversationController.getMessagesByConversationId);

router.post('/conversations/group', verifyToken, uploadCloudnary.single('image'), ConversationController.createGroupConversation);
router.put('/conversations/group/:id/add', verifyToken, ConversationController.addMemberInGroup);
router.get('/groupConversations', verifyToken, ConversationController.getUserGroupsConversations);
router.get('/conversation/:id/group', verifyToken, ConversationController.getGroupInfo);


export default router;
