
export type Post = {
    id: number;
    author: string;
    avatar?: string | null;
    community: string;
    title?: string;
    content: string;
    image?: string;
    comments: number;
    pay: string;
  }
