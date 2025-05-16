import { Comment } from "./comment.js";

export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
  comments?: Comment[];
}