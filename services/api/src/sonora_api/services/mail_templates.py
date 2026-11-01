"""Transactional e-mail texts. Russian is the launch language; see ROADMAP.md for i18n."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Mail:
    subject: str
    text: str


def verify_email(display_name: str, link: str, ttl_hours: int) -> Mail:
    return Mail(
        subject="Подтвердите e-mail в Sonora",
        text=(
            f"Привет, {display_name}!\n\nПодтвердите адрес, перейдя по ссылке:\n{link}\n\n"
            f"Ссылка действует {ttl_hours} ч."
        ),
    )


def password_reset(link: str, ttl_minutes: int) -> Mail:
    return Mail(
        subject="Сброс пароля Sonora",
        text=(
            f"Чтобы задать новый пароль, перейдите по ссылке:\n{link}\n\n"
            f"Ссылка действует {ttl_minutes} мин. Если вы не запрашивали сброс, просто проигнорируйте письмо."
        ),
    )
