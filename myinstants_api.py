from pathlib import Path
import re
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://www.myinstants.com"
SEARCH_URL = f"{BASE_URL}/en/search/?name={{query}}"
DOWNLOAD_DIR = Path("downloads")
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
DEFAULT_MAX_PAGES = 20
MAX_PAGES_CAP = 50


def _extract_mp3_url(onclick_value: str) -> str:
    match = re.search(r"['\"]([^'\"]+\.mp3[^'\"]*)['\"]", onclick_value)
    if match:
        return urljoin(BASE_URL, match.group(1))

    return ""


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return cleaned or "sound"


def _clamp_max_pages(value: int | str | None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return DEFAULT_MAX_PAGES

    if parsed <= 0:
        return DEFAULT_MAX_PAGES

    return min(parsed, MAX_PAGES_CAP)


def _build_page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url

    joiner = "&" if "?" in base_url else "?"
    return f"{base_url}{joiner}page={page}"


def _parse_search_results(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict[str, str]] = []

    for link in soup.find_all("div", class_="instant"):
        name_link = link.find("a", class_="instant-link")
        button_name = name_link.text.strip() if name_link else "Unknown Sound"

        small_button = link.find("button", class_="small-button")
        onclick_value = small_button.get("onclick", "") if small_button else ""
        button_url = _extract_mp3_url(onclick_value)

        if button_url:
            results.append(
                {
                    "name": button_name,
                    "mp3_url": button_url,
                }
            )

    return results


def search(search_term: str, max_pages: int | None = None) -> list[dict[str, str]]:
    if not search_term or not search_term.strip():
        return []

    query = quote_plus(search_term.strip())
    base_url = SEARCH_URL.format(query=query)
    total_pages = _clamp_max_pages(max_pages)
    headers = {"User-Agent": DEFAULT_USER_AGENT}

    results: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for page in range(1, total_pages + 1):
        page_url = _build_page_url(base_url, page)
        response = requests.get(page_url, timeout=15, headers=headers)
        response.raise_for_status()

        page_results = _parse_search_results(response.text)
        added = 0

        for item in page_results:
            mp3_url = item.get("mp3_url")
            if not mp3_url or mp3_url in seen_urls:
                continue
            seen_urls.add(mp3_url)
            results.append(item)
            added += 1

        if added == 0:
            break

    return results


def download_mp3(url: str, filename: str | None = None) -> str:
    DOWNLOAD_DIR.mkdir(exist_ok=True)

    response = requests.get(url, stream=True, timeout=30)
    response.raise_for_status()

    if filename:
        safe_name = _safe_filename(filename)
    else:
        path_name = Path(urlparse(url).path).name
        safe_name = _safe_filename(Path(path_name).stem or "sound")

    if not safe_name.lower().endswith(".mp3"):
        safe_name = f"{safe_name}.mp3"

    output_path = DOWNLOAD_DIR / safe_name

    with output_path.open("wb") as output_file:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                output_file.write(chunk)

    return str(output_path)
