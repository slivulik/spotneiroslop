import smtplib
from email.message import EmailMessage
from typing import Protocol

import anyio.to_thread

from sonora_api.core.config import Settings
from sonora_api.core.logging import get_logger

log = get_logger("sonora.email")


class EmailSender(Protocol):
    async def send(self, *, to: str, subject: str, text: str) -> None: ...


class ConsoleEmailSender:
    """Development backend: writes the message to the log instead of sending it."""

    def __init__(self) -> None:
        self.outbox: list[EmailMessage] = []

    async def send(self, *, to: str, subject: str, text: str) -> None:
        message = EmailMessage()
        message["To"], message["Subject"] = to, subject
        message.set_content(text)
        self.outbox.append(message)
        log.info("email_console", to=to, subject=subject, body=text)


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def send(self, *, to: str, subject: str, text: str) -> None:
        message = EmailMessage()
        message["From"] = self._settings.email_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text)
        await anyio.to_thread.run_sync(self._send_sync, message)

    def _send_sync(self, message: EmailMessage) -> None:
        s = self._settings
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as smtp:
            if s.smtp_starttls:
                smtp.starttls()
            if s.smtp_username:
                smtp.login(s.smtp_username, s.smtp_password.get_secret_value())
            smtp.send_message(message)


def create_email_sender(settings: Settings) -> EmailSender:
    return SmtpEmailSender(settings) if settings.email_backend == "smtp" else ConsoleEmailSender()


async def send_safely(sender: EmailSender, *, to: str, subject: str, text: str) -> None:
    """Background-task wrapper: a mail outage must not crash the worker or leak to the client."""
    try:
        await sender.send(to=to, subject=subject, text=text)
    except Exception:
        log.exception("email_send_failed", to=to, subject=subject)
