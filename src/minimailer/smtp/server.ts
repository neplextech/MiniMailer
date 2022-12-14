import { randomUUID } from "crypto";
import { SMTPServer, SMTPServerDataStream } from "smtp-server";
import { simpleParser } from "mailparser";
import { MailError } from "./MailError";
import { MiniMailer } from "../MiniMailer";

const SERVER_PORT = 50478 as const;

function createMessage(stream: SMTPServerDataStream) {
    return new Promise<import("mailparser").ParsedMail>((resolve, reject) => {
        stream.on("error", (err) => {
            reject(err);
        });

        stream.on("end", () => {
            if (stream.sizeExceeded) {
                const err = new MailError("Error: message exceeds fixed maximum message size 50 MB", 552);
                return reject(err);
            }
        });

        simpleParser(stream).then(
            (m) => resolve(m),
            (e) => reject(e)
        );
    });
}

interface ServerInfo {
    port: number;
    server: SMTPServer;
    mails: Array<ParsedMail>;
}

export function createSMTPServer(data: SMTPStartPayload & { app: MiniMailer }) {
    const { username, password, port, app } = data;
    const mailStore = new Array<ParsedMail>();
    const server = new SMTPServer({
        authOptional: !(!!username || !!password),
        disabledCommands: ["AUTH", "STARTTLS"],
        authMethods: ["PLAIN", "LOGIN", "CRAM-MD5"],
        size: 50 * 1024 * 1024,
        hidePIPELINING: true,
        onAuth(auth, session, callback) {
            if (username && auth.username !== username) {
                return callback(new MailError("Invalid username"));
            }
            if (password && auth.password !== password) {
                return callback(new MailError("Invalid password"));
            }
            callback(null, {
                user: randomUUID()
            });
        },
        onData(stream, session, callback) {
            createMessage(stream).then(
                (mail) => {
                    callback(null);
                    const uuid = randomUUID();
                    mailStore.unshift({
                        ...mail,
                        id: uuid
                    });
                    app.send("mails", [...mailStore.values()]);
                },
                (e) => callback(e || new MailError("failed to parse email"))
            );
        }
    });

    return {
        port: port ?? SERVER_PORT,
        server,
        mails: mailStore
    } as ServerInfo;
}
