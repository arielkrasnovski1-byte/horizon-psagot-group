# -*- coding: utf-8 -*-
"""
מחולל עמודי מאמר סטטיים.

הבעיה שהוא פותר: /article/?id=X הגיש לכל המאמרים אותו HTML — אותה כותרת
ואותו canonical שהצביע על /article/. גוגל ראתה שמונה כתובות זהות וסימנה
אותן "Alternate page with proper canonical tag", כלומר לא אינדקסה אף אחת.

הפתרון: עמוד HTML אמיתי לכל מאמר, עם כותרת, תיאור, canonical ו-JSON-LD
משלו, והטקסט בתוך ה-HTML ולא מוזרק ב-JavaScript.

הרצה:  python3 tools/build_articles.py
"""
import json, os, re, sys, unicodedata, urllib.request, pathlib, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://horizonpsagotgroup.com"
PROJECT = "horizon-psagot-group-ccbe6"
FS = (f"https://firestore.googleapis.com/v1/projects/{PROJECT}"
      f"/databases/(default)/documents/articles?pageSize=200")
SLUGMAP = ROOT / "data" / "article-slugs.json"


def load_firestore():
    try:
        with urllib.request.urlopen(FS, timeout=20) as r:
            data = json.load(r)
    except Exception as e:
        print(f"  Firestore unreachable ({e}) — falling back to data/articles.json")
        return None
    out = []
    for d in data.get("documents", []):
        f, rec = d["fields"], {"_doc": d["name"].split("/")[-1]}
        for k, v in f.items():
            if "stringValue" in v:      rec[k] = v["stringValue"]
            elif "integerValue" in v:   rec[k] = int(v["integerValue"])
            elif "doubleValue" in v:    rec[k] = int(v["doubleValue"])
        out.append(rec)
    return out or None


def load_json_articles():
    return json.loads((ROOT / "data" / "articles.json").read_text("utf-8"))["articles"]


def slugify(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-{2,}", "-", s)


def resolve_slugs(arts, json_arts):
    """Keyed on the Firestore document id, which is stable across title edits."""
    smap = json.loads(SLUGMAP.read_text("utf-8")) if SLUGMAP.exists() else {}
    by_title = {a.get("title_he", "").strip(): a.get("id") for a in json_arts}
    used = set(smap.values())
    for a in arts:
        key = a.get("_doc") or a.get("id")
        if a.get("slug"):
            smap[key] = a["slug"]
        elif key in smap:
            pass
        else:
            cand = by_title.get(a.get("title_he", "").strip()) or slugify(a.get("title_en", "")) or key
            base, n = cand, 2
            while cand in used:
                cand = f"{base}-{n}"; n += 1
            smap[key] = cand
        used.add(smap[key])
    SLUGMAP.parent.mkdir(exist_ok=True)
    SLUGMAP.write_text(json.dumps(smap, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return smap


def sub_between(text, start_pat, end_pat, new_inner, label):
    m = re.search(start_pat + r"(.*?)" + end_pat, text, re.S)
    if not m:
        raise SystemExit(f"TEMPLATE ERROR: could not locate {label}")
    return text[:m.start(1)] + new_inner + text[m.end(1):]


def render(tpl, a, slug, lang):
    en = lang == "en"
    title = (a.get("title_en") if en else a.get("title_he")) or a.get("title_he") or ""
    exc   = (a.get("excerpt_en") if en else a.get("excerpt_he")) or a.get("excerpt_he") or ""
    body  = (a.get("body_en") if en else a.get("body_he")) or a.get("body_he") or ""
    cat   = (a.get("category_en") if en else a.get("category_he")) or ""
    read  = (a.get("read_en") if en else a.get("read_he")) or ""
    brand = "Horizon Psagot Group" if en else "הורייזון פסגות גרופ"
    author = "Horizon Psagot Group" if en else "צוות הורייזון פסגות גרופ"
    he_url, en_url = f"{SITE}/article/{slug}/", f"{SITE}/en/article/{slug}/"
    self_url = en_url if en else he_url

    t = tpl
    t = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)} | {brand}</title>", t, count=1, flags=re.S)
    t = re.sub(r'(<meta name="description" content=")[^"]*(">)',
               lambda m: m.group(1) + html.escape(exc, quote=True) + m.group(2), t, count=1)
    t = re.sub(r'(<link rel="canonical" href=")[^"]*(">)', r"\g<1>" + self_url + r"\g<2>", t, count=1)
    t = re.sub(r'(<link rel="alternate" hreflang="he" href=")[^"]*(">)', r"\g<1>" + he_url + r"\g<2>", t, count=1)
    t = re.sub(r'(<link rel="alternate" hreflang="en" href=")[^"]*(">)', r"\g<1>" + en_url + r"\g<2>", t, count=1)
    t = re.sub(r'(<link rel="alternate" hreflang="x-default" href=")[^"]*(">)', r"\g<1>" + he_url + r"\g<2>", t, count=1)
    t = re.sub(r'(<meta property="og:url" content=")[^"]*(">)', r"\g<1>" + self_url + r"\g<2>", t, count=1)

    img = a.get("image") or "/assets/logo/og-image.png"
    ld = {
        "@context": "https://schema.org", "@type": "BlogPosting",
        "headline": title, "description": exc,
        "image": SITE + img if img.startswith("/") else img,
        "datePublished": a.get("date", ""),
        "author": {"@type": "Organization", "name": brand},
        "publisher": {"@type": "Organization", "name": brand,
                      "logo": {"@type": "ImageObject", "url": SITE + "/assets/logo/logo.png"}},
        "mainEntityOfPage": self_url,
        "inLanguage": "en" if en else "he",
    }
    t = t.replace("</head>", "  <script type=\"application/ld+json\">\n"
                  + json.dumps(ld, ensure_ascii=False, indent=2) + "\n  </script>\n</head>", 1)

    t = sub_between(t, r'id="articleTitle">', r"</h1>", html.escape(title), "#articleTitle")
    meta_inner = ("\n            " + f'<span class="category">{html.escape(cat)}</span>'
                  + "\n            " + f"<span>{html.escape(a.get('date',''))}</span>"
                  + "\n            " + f"<span>{html.escape(read)}</span>"
                  + "\n            " + f"<span>{'By: ' if en else 'מאת: '}{html.escape(author)}</span>"
                  + "\n          ")
    t = sub_between(t, r'id="articleMeta">', r"</div>", meta_inner, "#articleMeta")
    t = sub_between(t, r'id="articleBody">',
                    r"\n          </div>\n        </div>\n      </section>",
                    "\n" + body + "\n", "#articleBody")

    # the page is static now — the client-side renderer would only overwrite it
    t = t.replace('  <script src="/js/article.js" defer></script>\n', "")
    return t


def main():
    arts = load_firestore()
    src = "Firestore"
    json_arts = load_json_articles()
    if arts is None:
        arts, src = json_arts, "data/articles.json"
    print(f"  source: {src} — {len(arts)} articles")

    smap = resolve_slugs(arts, json_arts)
    he_tpl = (ROOT / "article" / "index.html").read_text("utf-8")
    en_tpl = (ROOT / "en" / "article" / "index.html").read_text("utf-8")

    written = []
    for a in sorted(arts, key=lambda x: x.get("order", 999)):
        slug = smap[a.get("_doc") or a.get("id")]
        for lang, tpl, base in (("he", he_tpl, ROOT / "article"), ("en", en_tpl, ROOT / "en" / "article")):
            d = base / slug
            d.mkdir(parents=True, exist_ok=True)
            (d / "index.html").write_text(render(tpl, a, slug, lang), "utf-8")
        written.append((slug, a.get("title_he", "")[:38]))
        print(f"    /article/{slug}/")

    # sitemap
    sm = ROOT / "sitemap.xml"; s = sm.read_text("utf-8")
    s = re.sub(r"\n  <!-- articles -->.*?<!-- /articles -->", "", s, flags=re.S)
    block = "\n  <!-- articles -->"
    for slug, _ in written:
        for u in (f"{SITE}/article/{slug}/", f"{SITE}/en/article/{slug}/"):
            block += f"\n  <url><loc>{u}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>"
    block += "\n  <!-- /articles -->"
    s = s.replace("</urlset>", block + "\n</urlset>")
    sm.write_text(s, "utf-8")
    print(f"  sitemap.xml: {len(written)*2} article URLs")
    print(f"  slug map: data/article-slugs.json")


if __name__ == "__main__":
    main()
