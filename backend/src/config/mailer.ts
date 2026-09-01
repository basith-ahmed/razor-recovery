import nodemailer from "nodemailer";
import { env } from "./env";

const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

export { mailer };
