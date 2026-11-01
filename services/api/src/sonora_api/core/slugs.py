import re
import unicodedata

_CYRILLIC = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya", "і": "i", "ї": "yi", "є": "ye", "ґ": "g",
}  # fmt: skip


def slugify(text: str, max_length: int = 80) -> str:
    """'Земфира — Хочешь?' → 'zemfira-hochesh'. Never empty."""
    lowered = "".join(_CYRILLIC.get(ch, ch) for ch in text.lower())
    ascii_only = unicodedata.normalize("NFKD", lowered).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")[:max_length].strip("-")
    return slug or "untitled"
