import argparse
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


WIDTH, HEIGHT = A4
NAVY = HexColor("#07111f")
SLATE = HexColor("#334155")
MUTED = HexColor("#64748b")
LIGHT = HexColor("#e2e8f0")
CYAN = HexColor("#0891b2")
PALE = HexColor("#ecfeff")
GREEN = HexColor("#047857")


def wrapped_text(pdf: canvas.Canvas, text: str, x: float, y: float, width: float, size: float = 9, leading: float = 12, color=SLATE, font: str = "Helvetica") -> float:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    pdf.setFont(font, size)
    pdf.setFillColor(color)
    for line in lines:
        pdf.drawString(x, y, line)
        y -= leading
    return y


def card(pdf: canvas.Canvas, x: float, y: float, width: float, height: float, title: str, steps: list[str]) -> None:
    pdf.setFillColor(white)
    pdf.setStrokeColor(HexColor("#cbd5e1"))
    pdf.roundRect(x, y - height, width, height, 10, fill=1, stroke=1)
    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(x + 14, y - 22, title)
    cursor = y - 43
    for index, step in enumerate(steps, start=1):
        pdf.setFillColor(CYAN)
        pdf.circle(x + 20, cursor + 3, 8, fill=1, stroke=0)
        pdf.setFillColor(white)
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawCentredString(x + 20, cursor, str(index))
        cursor = wrapped_text(pdf, step, x + 34, cursor + 5, width - 48, size=8.5, leading=11) - 5


def create_pdf(output: Path, app_url: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=A4, pageCompression=1)
    pdf.setTitle("Ersatzteillager - Mobile Kurzanleitung")
    pdf.setAuthor("Ersatzteillager")

    pdf.setFillColor(NAVY)
    pdf.rect(0, HEIGHT - 112, WIDTH, 112, fill=1, stroke=0)
    pdf.setFillColor(HexColor("#67e8f9"))
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(38, HEIGHT - 35, "MOBILE KURZANLEITUNG")
    pdf.setFillColor(white)
    pdf.setFont("Helvetica-Bold", 25)
    pdf.drawString(38, HEIGHT - 68, "Ersatzteillager einrichten")
    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(LIGHT)
    pdf.drawString(38, HEIGHT - 89, "iOS 16+ · Android 10+ · Firmen-WLAN oder VPN · Onlinebetrieb")

    qr_x, qr_y, qr_size = WIDTH - 112, HEIGHT - 97, 70
    pdf.setFillColor(white)
    pdf.roundRect(qr_x, qr_y, qr_size, qr_size, 5, fill=1, stroke=0)
    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawCentredString(qr_x + qr_size / 2, qr_y + 39, "QR-CODE")
    pdf.setFont("Helvetica", 7)
    pdf.drawCentredString(qr_x + qr_size / 2, qr_y + 26, "DER IT")

    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(38, HEIGHT - 145, "1. Adresse öffnen und installieren")
    wrapped_text(pdf, f"Scanne den QR-Code der IT oder öffne {app_url}. Verwende nur die HTTPS-Adresse ohne Zertifikatswarnung.", 38, HEIGHT - 164, WIDTH - 76, size=9.5, leading=13)

    card(pdf, 38, HEIGHT - 194, 250, 150, "iPhone / iPad (Safari)", [
        "Adresse in Safari öffnen und auf Teilen tippen.",
        "Zum Home-Bildschirm wählen; falls nötig unter Aktionen bearbeiten einblenden.",
        "Als Web-App öffnen aktivieren, Hinzufügen tippen und das neue Symbol starten.",
    ])
    card(pdf, 307, HEIGHT - 194, 250, 150, "Android (Chrome)", [
        "Adresse im aktuellen Chrome öffnen.",
        "Menü ⋮ öffnen und App installieren oder Zum Startbildschirm hinzufügen wählen.",
        "Installation bestätigen und das neue Symbol starten.",
    ])

    section_y = HEIGHT - 374
    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(38, section_y, "2. Geführte Ersteinrichtung")
    assistant = [
        ("1", "Installation", "Hinweise prüfen und im Startbildschirm-Modus öffnen."),
        ("2", "Kamera", "Zugriff erlauben. Der Test speichert kein Kamerabild."),
        ("3", "Testbuchung", "Freigegebenes Testteil öffnen und genau einmal Zugang oder Entnahme buchen."),
    ]
    box_y = section_y - 22
    box_w = 160
    for index, (number, title, description) in enumerate(assistant):
        x = 38 + index * 174
        pdf.setFillColor(PALE)
        pdf.setStrokeColor(HexColor("#a5f3fc"))
        pdf.roundRect(x, box_y - 102, box_w, 102, 10, fill=1, stroke=1)
        pdf.setFillColor(CYAN)
        pdf.circle(x + 22, box_y - 23, 12, fill=1, stroke=0)
        pdf.setFillColor(white)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawCentredString(x + 22, box_y - 27, number)
        pdf.setFillColor(NAVY)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(x + 42, box_y - 27, title)
        wrapped_text(pdf, description, x + 13, box_y - 50, box_w - 26, size=8.3, leading=11)

    booking_y = box_y - 127
    pdf.setFillColor(NAVY)
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(38, booking_y, "3. Im Alltag")
    daily = [
        "QR-Scanner öffnen, Kamera erlauben und Artikelcode erfassen.",
        "Menge, Richtung und Grund vor Bestätigen kontrollieren. Nicht doppelt tippen.",
        "Bei Netzwerkfehlern nicht wiederholt buchen; Meldung und Uhrzeit an die IT geben.",
    ]
    pdf.setFillColor(HexColor("#f8fafc"))
    pdf.setStrokeColor(HexColor("#cbd5e1"))
    pdf.roundRect(38, booking_y - 105, WIDTH - 76, 82, 9, fill=1, stroke=1)
    for index, item in enumerate(daily):
        cursor = booking_y - 44 - index * 22
        pdf.setFillColor(GREEN)
        pdf.circle(54, cursor + 3, 3, fill=1, stroke=0)
        wrapped_text(pdf, item, 66, cursor + 7, WIDTH - 120, size=9, leading=12)

    warning_y = 145
    pdf.setFillColor(HexColor("#fff7ed"))
    pdf.setStrokeColor(HexColor("#fdba74"))
    pdf.roundRect(38, warning_y, WIDTH - 76, 54, 9, fill=1, stroke=1)
    pdf.setFillColor(HexColor("#9a3412"))
    pdf.setFont("Helvetica-Bold", 9.5)
    pdf.drawString(52, warning_y + 35, "Wichtig")
    wrapped_text(pdf, "Etikettendruck wird auf Mobilgeräten nicht angeboten. Backups der vollständigen Datenbank führt die IT auf dem Server aus.", 52, warning_y + 20, WIDTH - 104, size=8.5, leading=11, color=HexColor("#7c2d12"))

    pdf.setStrokeColor(HexColor("#cbd5e1"))
    pdf.line(38, 83, WIDTH - 38, 83)
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(38, 65, "Hilfe: Passwort vergessen oder Kamera dauerhaft verweigert? Wende dich an den zuständigen Administrator bzw. die IT.")
    pdf.drawString(38, 49, "Keine Passwörter, Lieferscheine oder personenbezogenen Daten in Support-Tickets kopieren.")
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawRightString(WIDTH - 38, 49, "Stand: 22.11.2026")

    pdf.showPage()
    pdf.save()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="output/pdf/Anwender-Kurzanleitung-Mobil.pdf")
    parser.add_argument("--app-url", default="https://lager.firma.example/installieren")
    args = parser.parse_args()
    create_pdf(Path(args.output), args.app_url)


if __name__ == "__main__":
    main()
