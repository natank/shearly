import { createConnection } from 'node:net';

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain-text fallback — every HTML email needs one for clients that don't render HTML. */
  text: string;
  html: string;
};

/**
 * NOT-003: "the channel is abstracted so SMS or push can be added without
 * changing callers." NotificationService depends only on this interface —
 * SmtpEmailChannel is today's only implementation, but a fake channel in
 * tests proves the swap needs no caller-side change (same contract-test
 * shape as M4-P2's Stripe-stub-mode pattern).
 */
export type NotificationChannel = {
  send(message: EmailMessage): Promise<void>;
};

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

/**
 * design §10.3: SES in prod, Mailhog locally — both speak SMTP, so this
 * reuses the same `SMTP_URL` config surface identity's password-reset mail
 * already uses, rather than a separate SES SDK integration. MIME
 * multipart/alternative carries both the plain-text fallback and the HTML
 * body in one message.
 */
export function createSmtpEmailChannel(
  smtpUrl: string,
  from = 'noreply@shearly.local',
): NotificationChannel {
  return {
    async send(message: EmailMessage): Promise<void> {
      const url = new URL(smtpUrl);
      const host = url.hostname;
      const port = Number(url.port || 25);
      const boundary = `shearly-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const body = [
        `Subject: ${message.subject}`,
        `To: ${message.to}`,
        `From: ${from}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        message.text,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        message.html,
        '',
        `--${boundary}--`,
      ].join('\r\n');

      await smtpExchange(host, port, [
        'EHLO localhost\r\n',
        `MAIL FROM:<${from}>\r\n`,
        `RCPT TO:<${message.to}>\r\n`,
        'DATA\r\n',
        `${body}\r\n.\r\n`,
        'QUIT\r\n',
      ]);
    },
  };
}
