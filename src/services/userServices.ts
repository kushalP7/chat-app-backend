import User from "../models/userModel";
import { IUser } from "../interfaces/userInterface";
import bcrypt from 'bcrypt'
import { JwtUtills } from "../utils/jwtUtiils"

class UserServices {
    public async createUser(newUser: IUser): Promise<IUser> {

        const hashPassword = await bcrypt.hash(newUser.password, 10);

        newUser.password = hashPassword;
        const user = new User(newUser);

        return await user.save();

    }

    public async loginUser(email: string, password: string): Promise<any> {

        let user;
        user = await User.findOne({ email: email })

        if (!user) {
            throw new Error(`User with Email ${email} not found`);
        }

        const pass = await bcrypt.compare(password, user.password);

        if (!pass) {
            throw new Error(`Incorrect password`);
        }
        // const userId = user.id;
        // const userName = user.username;
        const token = JwtUtills.generateToken(user.id);
        return { token, user };
    }

    public async allUser(): Promise<IUser[]> {
        const user = User.aggregate(
            [
                {
                    $project: {
                        username: 1,
                        email: 1,
                        role: 1
                    }
                }
            ]
        )
        return user;
    }

    public async deleteUser(id: string): Promise<void> {
        await User.findByIdAndDelete(id);
    }

    public async getUserByUserName(username: string): Promise<any> {
        const user = await User.findOne({ username: username });
        return user;
    }

    public async getUserById(userId: string): Promise<any> {
        return await User.findById(userId);
    }

    public async getAllUsersExceptCurrentUser(userId: string): Promise<any> {
        return await User.find({ _id: { $ne: userId } });
    }

    


}

export default new UserServices();