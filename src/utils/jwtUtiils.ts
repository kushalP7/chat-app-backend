import jwt from "jsonwebtoken";
import * as dotenv from 'dotenv'
dotenv.config();

export class JwtUtills {
    static key:string = process.env.secretKey || "KP";

    static generateToken(userId:string):string{
        const token = jwt.sign({userId},this.key,{expiresIn:'24h'})
        return token;
    }

    static verifyToken(token:string):string|object{
        try {
            const decode = jwt.verify(token,this.key)
            
            return decode
        } catch (error) {
            throw new Error('Invalid token');
        }
    }
}
