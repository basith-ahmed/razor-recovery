import nodemailer from "nodemailer";
import { env } from "./env";

const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
  // Mailhog does not require auth
});

export { mailer };
