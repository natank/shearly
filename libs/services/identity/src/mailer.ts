import { createConnection } from 'node:net';

export type ResetMail = {
  to: string;
  subject: string;
  text: string;
};

export type SendMail = (mail: ResetMail) => Promise<void>;

function smtpExchange(host: string, port: number, commands: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let buffer = '';
    let index = 0;
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setEncoding('utf8');
    socket.on('error', fail);
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes('\n')) {
        return;
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      const last = lines.filter(Boolean).at(-1) ?? '';
      if (!/^[23]\d\d/.test(last)) {
        fail(new Error(`SMTP error: ${last}`));
        return;
      }
      if (index >= commands.length) {
        socket.end();
        resolve();
        return;
      }
      socket.write(commands[index] ?? '');
      index += 1;
    });
  });
}

export function createSmtpMailer(smtpUrl: string, from = 'noreply@shearly.local'): SendMail {
  return async (mail) => {
    const url = new URL(smtpUrl);
    const host = url.hostname;
    const port = Number(url.port || 25);
    await smtpExchange(host, port, [
      'EHLO localhost\r\n',
      `MAIL FROM:<${from}>\r\n`,
      `RCPT TO:<${mail.to}>\r\n`,
      'DATA\r\n',
      `Subject: ${mail.subject}\r\nTo: ${mail.to}\r\nFrom: ${from}\r\n\r\n${mail.text}\r\n.\r\n`,
      'QUIT\r\n',
    ]);
  };
}
