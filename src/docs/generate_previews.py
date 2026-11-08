#!/usr/bin/env python3
"""Draw disclosed documentation illustrations, never real DSH screenshots.

Requires Pillow and a deliberately sanitized, generatedPreview=true JSON export.
No browser, network, live DSH access, private catalog discovery or UI verification.
Only allowlisted display fields are rendered; identifiers and paths are not drawn.
Run from the package root; see docs/USAGE.md for the input and disclosure policy.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

WIDTH, HEIGHT = 1800, 1280
DISCLOSURE = "Сгенерированное демо-превью · не снимок работающего DSH"
PALETTES = {
    # Documentation artwork approximating client.js alias-token roles, not runtime tokens.
    "light": {"base": "#ffffff", "layer": "#f6f7f9", "line": "#e3e6eb", "text": "#20242b", "muted": "#737b88", "brand": "#5269d8", "selected": "#f0f3ff", "green": "#328266"},
    "dark": {"base": "#191c21", "layer": "#22262d", "line": "#343a44", "text": "#e9edf3", "muted": "#9ba5b5", "brand": "#96a5ff", "selected": "#282f49", "green": "#83c9aa"},
}


def validate_public_data(data: dict) -> None:
    """Reject common unsanitized metadata rather than publish it accidentally."""
    if data.get("generatedPreview") is not True or data.get("apiVersion") != 1:
        raise ValueError("Input must be an explicitly sanitized generatedPreview API v1 export")
    if not isinstance(data.get("skills"), list) or not isinstance(data.get("groups"), list):
        raise ValueError("Expected sanitized skills and groups arrays")
    counts = data.get("counts", {})
    for key in ("groupCount", "instanceCount", "count24h", "count7d", "total"):
        if not isinstance(counts.get(key), int) or isinstance(counts[key], bool) or counts[key] < 0:
            raise ValueError(f"Missing or invalid aggregate count: {key}")
    if counts["groupCount"] < len(data["groups"]) or counts["instanceCount"] < len(data["skills"]):
        raise ValueError("Public examples cannot exceed aggregate inventory counts")
    known_ids = {skill.get("id") for skill in data["skills"]}
    if any(not isinstance(item, str) or not item.startswith("demo-") for item in known_ids):
        raise ValueError("Replace instance identifiers with demo-only identifiers")
    if len(known_ids) != len(data["skills"]):
        raise ValueError("Public instance identifiers must remain unique")
    for group in data["groups"]:
        ids = group.get("instanceIds", [])
        if not ids or len(set(ids)) != len(ids) or not set(ids).issubset(known_ids):
            raise ValueError("Every illustrated group must contain all its public instances")
        if group.get("instanceCount") != len(ids):
            raise ValueError("Do not illustrate partial instance membership as a whole group")
    def walk(value, key=""):
        if isinstance(value, dict):
            for child_key, child in value.items():
                if child_key == "sessionId" and child:
                    raise ValueError("Session identifiers must be removed")
                if child_key == "contextId" and child and not str(child).startswith("demo-"):
                    raise ValueError("Context identifiers must be demo-only")
                if child_key in ("path", "cwd") and child not in (None, "[путь скрыт]", "[redacted]"):
                    raise ValueError("Filesystem locations must be removed, not shortened")
                walk(child, child_key)
        elif isinstance(value, list):
            for child in value:
                walk(child, key)
        elif isinstance(value, str):
            if re.search(r"(?:/Users|/home)/[^/\s]+|[A-Za-z]:\\Users\\", value):
                raise ValueError("A private home location remains in the input")
    walk(data)


class Canvas:
    def __init__(self, theme: str, regular: str | None, bold: str | None):
        self.p = PALETTES[theme]
        self.image = Image.new("RGB", (WIDTH, HEIGHT), self.p["base"])
        self.draw = ImageDraw.Draw(self.image)
        self.font_cache = {}
        self.regular, self.bold = regular, bold

    def font(self, size=18, bold=False):
        key = (size, bold)
        if key not in self.font_cache:
            requested = self.bold if bold else self.regular
            candidates = [requested] if requested else []
            candidates += ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", "Arial Bold.ttf" if bold else "Arial.ttf", "LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf"]
            for candidate in candidates:
                try:
                    self.font_cache[key] = ImageFont.truetype(candidate, size)
                    break
                except OSError:
                    continue
            else:
                raise RuntimeError("A Cyrillic-capable font is required; pass --font and --font-bold")
        return self.font_cache[key]

    def text(self, x, y, value, size=18, color="text", bold=False):
        self.draw.text((x, y), str(value), font=self.font(size, bold), fill=self.p.get(color, color))

    def ellipsis(self, x, y, value, width, size=18, color="text", bold=False):
        value = str(value)
        font = self.font(size, bold)
        rendered = value
        while rendered and self.draw.textlength(rendered, font=font) > width:
            rendered = rendered[:-1]
        if rendered != value:
            while rendered and self.draw.textlength(rendered + "…", font=font) > width:
                rendered = rendered[:-1]
            rendered += "…"
        self.text(x, y, rendered, size, color, bold)

    def paragraph(self, x, y, value, width, size=17, color="muted", lines=3, gap=7, bold=False):
        words = str(value).split()
        rows = []
        font = self.font(size, bold)
        while words and len(rows) < lines:
            row = words.pop(0)
            while words and self.draw.textlength(row + " " + words[0], font=font) <= width:
                row += " " + words.pop(0)
            rows.append(row)
        for index, row in enumerate(rows):
            if index == lines - 1 and words:
                row += " …"
            self.ellipsis(x, y + index * (size + gap), row, width, size, color, bold)
        return len(rows) * (size + gap)

    def rect(self, box, fill="base", radius=12, outline="line", width=1):
        self.draw.rounded_rectangle(box, radius, fill=self.p.get(fill, fill), outline=self.p.get(outline, outline) if outline else None, width=width)

    def line(self, x1, y1, x2, y2, color="line", width=1):
        self.draw.line((x1, y1, x2, y2), fill=self.p[color], width=width)

    def button(self, x, y, text, width=190, primary=False):
        self.rect((x, y, x + width, y + 42), radius=8)
        self.text(x + 14, y + 10, text, 16, "brand" if primary else "text")

    def status(self, x, y, status):
        label = {"present": "Присутствует", "missing": "Отсутствует", "unavailable": "Недоступен", "mixed": "Смешанное"}.get(status, "Неизвестно")
        color = "green" if status == "present" else "muted"
        self.draw.ellipse((x, y + 7, x + 6, y + 13), fill=self.p[color])
        self.text(x + 13, y + 1, label, 14, color)

    def footer(self, data):
        self.line(40, 1198, WIDTH - 40, 1198)
        self.text(40, 1217, DISCLOSURE, 20, "brand", True)
        self.text(40, 1248, f"Сводка: {data['counts']['groupCount']} имён / {data['counts']['instanceCount']} экземпляров · Публичные примеры: {len(data['groups'])} групп · Расположения и участники обезличены", 15, "muted")

    def save(self, path):
        info = PngImagePlugin.PngInfo()
        info.add_text("Title", "DSH Skill Manager — generated documentation illustration")
        info.add_text("Disclosure", DISCLOSURE)
        info.add_text("Verification", "Not a screenshot; not visual verification of a running application")
        self.image.save(path, pnginfo=info, optimize=True)



def formatted(value):
    return f"{value:,}".replace(",", " ") if isinstance(value, int) else "—"


def draw_header(c, data, detail=False):
    c.rect((40, 38, 98, 96), radius=13)
    for offset in (0, 9, 18):
        c.draw.line([(52, 55 + offset), (69, 46 + offset), (86, 55 + offset), (69, 64 + offset), (52, 55 + offset)], fill=c.p["brand"], width=2)
    c.text(116, 35, "Менеджер навыков", 34, bold=True)
    c.text(116, 84, "Каталог навыков, использование и наблюдаемая история в одном месте.", 18, "muted")
    c.text(1420, 36, "ДЕМОНСТРАЦИОННОЕ ПРЕВЬЮ", 14, "brand", True)
    c.button(1550, 73, "Обновить каталог", 210, True)
    labels = [("Уникальных названий", "groupCount"), ("Канонических экземпляров", "instanceCount"), ("Вызовы · 24 часа", "count24h"), ("Вызовы · 7 дней", "count7d"), ("Вызовы · за период", "total")]
    w = (1720 - 4 * 14) / 5
    for index, (label, key) in enumerate(labels):
        x = 40 + index * (w + 14)
        c.rect((x, 146, x + w, 258), fill="layer" if index == 0 else "base")
        c.text(x + 19, 164, label, 16, "muted")
        c.text(x + 19, 195, formatted(data["counts"][key]), 37, bold=True)
    c.rect((40, 282, 1760, 379), fill="layer", radius=10)
    c.draw.polygon(((60, 304), (70, 304), (65, 311)), fill=c.p["muted"])
    c.text(79, 297, "Период наблюдения", 18, bold=True)
    c.text(59, 329, "Только записанные попытки загрузки инструкций, включая ошибки. История до установки не восстанавливается.", 17, "muted")
    c.text(59, 353, "Загрузка инструкций не доказывает выполнение скрипта или успешность задачи.", 16, "muted")
    c.text(42, 403, "Группировка по точному названию. Одинаковое имя и неизвестные хеши не доказывают равенство содержимого.", 16, "muted")
    controls = [(40, 690, "Поиск навыков", data["selectedName"] if detail else "Название, описание, источник, путь или база ресурсов…"), (744, 310, "Источник", "Все источники"), (1068, 310, "Состояние", "Все состояния"), (1392, 368, "Сортировка", "Название · А–Я")]
    for x, width, label, value in controls:
        c.text(x, 447, label, 15, "muted")
        c.rect((x, 475, x + width, 519), radius=8)
        c.ellipsis(x + 13, 487, value, width - 28, 16, "text" if detail and label == "Поиск навыков" else "muted")


def draw_table_head(c, data, detail=False):
    x, y, width, height = 40, 550, 1120, 625
    c.rect((x, y, x + width, y + height), radius=13)
    c.text(x + 20, y + 17, "Каталог", 20, bold=True)
    shown = 1 if detail else len(data["groups"])
    c.text(x + 470, y + 22, f"Публичные примеры: {shown} из {data['counts']['groupCount']} групп", 15, "muted")
    c.paragraph(x + 20, y + 55, "Фильтры находят экземпляры; группы сохраняют все экземпляры и полные счётчики.", width - 38, 15, lines=2, gap=3)
    c.line(x, y + 106, x + width, y + 106)
    c.draw.rectangle((x + 1, y + 107, x + width - 1, y + 151), fill=c.p["layer"])
    widths = [295, 74, 207, 125, 72, 72, 95, 180]
    labels = ["Навык", "Экз.", "Источник / провайдер", "Состояние", "24 ч", "7 д", "За период", "Использован"]
    positions = []
    current = x
    for label, col_width in zip(labels, widths):
        positions.append(current)
        c.text(current + 12, y + 122, label, 13, "muted")
        current += col_width
    return positions, y + 152


def draw_group_row(c, group, columns, y, expanded=False):
    if expanded:
        c.draw.rectangle((41, y, 1159, y + 78), fill=c.p["selected"])
        c.draw.rectangle((41, y, 44, y + 78), fill=c.p["brand"])
    xx = columns[0] + 14
    points = ((xx, y + 19), (xx + 9, y + 19), (xx + 4, y + 26)) if expanded else ((xx, y + 17), (xx + 7, y + 22), (xx, y + 27))
    c.draw.polygon(points, fill=c.p["muted"])
    c.ellipsis(columns[0] + 31, y + 12, group["name"], 260, 16, bold=True)
    c.ellipsis(columns[0] + 30, y + 40, group.get("description", "Описание не сообщается"), 262, 13, "muted")
    c.text(columns[1] + 18, y + 15, formatted(group["instanceCount"]), 16)
    c.ellipsis(columns[2] + 12, y + 12, " · ".join(group.get("sources", [])), 188, 14)
    c.ellipsis(columns[2] + 12, y + 38, " · ".join(group.get("providers", [])), 188, 12, "muted")
    c.status(columns[3] + 10, y + 14, group.get("status"))
    for index, key in enumerate(("count24h", "count7d", "total")):
        c.text(columns[4 + index] + 23, y + 15, formatted(group.get("usage", {}).get(key)), 17, bold=expanded)
    c.text(columns[7] + 12, y + 17, "Дата скрыта" if group.get("usage", {}).get("lastAt") else "Нет загрузок", 13, "muted")
    c.line(41, y + 78, 1159, y + 78)


def draw_overview(data, args):
    c = Canvas("light", args.font, args.font_bold)
    draw_header(c, data)
    columns, y = draw_table_head(c, data)
    for group in data["groups"][:6]:
        draw_group_row(c, group, columns, y)
        y += 78
    c.rect((1184, 550, 1760, 1175), radius=13)
    cx = 1472
    c.rect((cx - 35, 725, cx + 35, 795), fill="layer", radius=16)
    c.line(cx - 14, 773, cx + 13, 747, "brand", 2)
    c.line(cx - 3, 747, cx + 13, 747, "brand", 2)
    c.line(cx + 13, 747, cx + 13, 763, "brand", 2)
    c.text(1323, 827, "Выберите экземпляр", 23, bold=True)
    c.paragraph(1260, 872, "Раскройте группу по названию и выберите экземпляр для просмотра авторства, доступности по контекстам и истории событий.", 425, 18, lines=4, gap=9)
    c.paragraph(1252, 1050, "Показаны публичные примеры, а не весь приватный каталог.", 430, 16, lines=2)
    c.footer(data)
    return c


def draw_expanded(data, args):
    c = Canvas("dark", args.font, args.font_bold)
    draw_header(c, data, True)
    selected = next((group for group in data["groups"] if group["name"] == data["selectedName"]), None)
    if not selected:
        raise ValueError("selectedName must refer to an included public group")
    members = [skill for skill in data["skills"] if skill["id"] in selected["instanceIds"]]
    if len(members) != 1:
        raise ValueError("This single-instance detail illustration requires an honest one-instance public group")
    skill = members[0]
    columns, y = draw_table_head(c, data, True)
    draw_group_row(c, selected, columns, y, True)
    c.text(62, y + 98, "Все экземпляры группы с этим названием", 18, bold=True)
    c.text(62, y + 130, "Полные счётчики группы · Совпавших экземпляров: 1 / 1", 14, "muted")
    card_y = y + 170
    c.rect((61, card_y, 1139, card_y + 282), radius=10, outline="brand")
    c.status(82, card_y + 15, skill["status"])
    c.button(902, card_y + 8, "Выбранный экземпляр", 217)
    for xx, label, value in [(82, "Источник", skill.get("source", "Неизвестно")), (620, "Провайдер", skill.get("provider", "Неизвестно")), (82, "Путь", "[путь скрыт]"), (620, "База ресурсов", "Расположение скрыто"), (82, "Описание", skill.get("description", "Неизвестно")), (620, "Хеш инструкции", "Неизвестно" if not skill.get("contentHash") else "Известный хеш скрыт")]:
        row = 0 if label in ("Источник", "Провайдер") else 1 if label in ("Путь", "База ресурсов") else 2
        yy = card_y + 67 + row * 49
        c.text(xx, yy, label, 13, "muted")
        c.ellipsis(xx, yy + 21, value, 490, 15)
    c.line(82, card_y + 219, 1118, card_y + 219)
    for index, (key, label) in enumerate((("count24h", "24 часа"), ("count7d", "7 дней"), ("total", "За период"))):
        xx = 82 + index * 350
        c.text(xx, card_y + 230, label, 13, "muted")
        c.text(xx + 130, card_y + 227, formatted(skill.get("usage", {}).get(key)), 21, bold=True)
    # This panel intentionally omits event bodies and identities unavailable in public input.
    c.rect((1184, 550, 1760, 1175), radius=13)
    c.text(1207, 570, "Информация об экземпляре", 14, "muted")
    c.ellipsis(1207, 599, skill["name"], 520, 25, bold=True)
    c.status(1207, 641, skill["status"])
    c.paragraph(1207, 678, skill.get("description", ""), 521, 16, lines=2, gap=6)
    c.line(1185, 740, 1759, 740)
    c.text(1207, 757, "Наблюдаемое использование", 17, bold=True)
    for index, (key, label) in enumerate((("count24h", "24 часа"), ("count7d", "7 дней"), ("total", "За период"))):
        xx = 1207 + index * 175
        c.text(xx, 791, label, 14, "muted")
        c.text(xx, 817, formatted(skill.get("usage", {}).get(key)), 27, bold=True)
    c.line(1185, 865, 1759, 865)
    c.text(1207, 882, "Жизненный цикл и авторство", 17, bold=True)
    for index, (title, note) in enumerate((("Создан / изменён", "Даты скрыты; автор неизвестен"), ("Последняя загрузка", "Дата и участник обезличены"), ("История событий", "События в публичный пример не включены"))):
        yy = 921 + index * 57
        if index < 2:
            c.line(1211, yy + 8, 1211, yy + 65)
        c.draw.ellipse((1207, yy + 5, 1215, yy + 13), fill=c.p["base"], outline=c.p["muted"])
        c.text(1230, yy, title, 15)
        c.text(1230, yy + 24, note, 13, "muted")
    availability = skill.get("availability", [])
    effective = sum(item.get("effective") is True for item in availability)
    c.line(1185, 1090, 1759, 1090)
    c.text(1207, 1107, "Доступность · обезличенный фрагмент", 16, bold=True)
    c.text(1207, 1138, f"Контекстов показано: {len(availability)} · effective: {effective}", 14, "muted")
    c.footer(data)
    return c


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Already sanitized public JSON; never a raw live snapshot")
    parser.add_argument("--output", type=Path, default=Path("docs/images"))
    parser.add_argument("--font", help="Optional regular font supporting Cyrillic")
    parser.add_argument("--font-bold", help="Optional bold font supporting Cyrillic")
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    validate_public_data(data)
    if not data["groups"] or len(data["groups"]) > 6:
        raise ValueError("Supply one to six complete public example groups, not a raw catalog")
    args.output.mkdir(parents=True, exist_ok=True)
    for filename, illustration in (("catalog-overview.png", draw_overview(data, args)), ("group-details.png", draw_expanded(data, args))):
        destination = args.output / filename
        illustration.save(destination)
        print(f"Generated disclosed illustration: {destination.name} ({WIDTH}×{HEIGHT})")


if __name__ == "__main__":
    main()
