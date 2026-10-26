declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        role: "PELAPOR" | "ADMIN";
        accountStatus: "ACTIVE" | "SUSPENDED";
      };
      sessionToken?: string;
      csrfHash?: string;
    }
  }
}

export {};
