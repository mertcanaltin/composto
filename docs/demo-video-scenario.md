# Composto v0.6.0 Demo Video Scenario

**Goal:** 2-3 dakikada "Composto olmadan agent bug'ı tekrar ediyordu → Composto uyarısıyla davranış değişti" hikayesini göster.

**Hedef dosya:** `scripts/demo-video.ts` (composto repo). Verdict: **medium**, revert_match strength 1.0. Gerçek sinyal ateşliyor.

---

## Ön hazırlık (kayıt öncesi, bir kere)

1. Terminal penceresi hazır, çözünürlük 1280×720 minimum
2. `cd /Users/mert/Desktop/enjoy/composto`
3. `git status` → temiz working tree doğrula
4. Terminal temiz (`clear`)
5. **Claude Code** ayrı pencerede composto repo'da açık; bir önceki konuşma temiz (yeni session)
6. Screen recorder hazır (QuickTime Player veya OBS)
7. `composto stats --disable` sonra yeniden enable etme — önceki invocation'lar demo'yu bulandırmasın. **Veya:** kayıttan önce `.composto/memory.db` yedekle, sonra restore et (aşağıda not)

**Optional — temiz telemetry:**
```bash
# Yedekle
cp .composto/memory.db /tmp/composto-backup.db

# Demo sonrası restore
mv /tmp/composto-backup.db .composto/memory.db
```

---

## Sahne 1: Problem (15 saniye) — "Agent tarih kör"

**Ekran:** Terminal + VSCode/Claude Code yan yana.

**Anlatım (voiceover veya alt yazı):**
> "Coding agent'ın bir sorunu var: mevcut koda bakıyor, tarihe bakmıyor. Geçen ay revert edilmiş bir değişikliği bugün tekrar commit edebilir. Gösterelim."

**Komut:**
```bash
git log --oneline --all -- scripts/demo-video.ts | head
```

**Göstermek için:** bu dosyanın revert history'sinde `Revert "fix(#2)..."` commit'i olmalı. Ekranda o satırı highlight et (fare ile veya annotasyon tool).

> "Bu dosya 3 hafta önce revert edildi. Bug vardı. Agent bunu bilmiyor."

---

## Sahne 2: Kurulum (20 saniye) — "Tek komut"

**Komut:**
```bash
composto init --client=claude-code
```

**Beklenen output:**
```
composto init — configured for claude-code

  merged  .claude/settings.json

Restart your AI client and check that 'composto' MCP is green.
Composto collects local-only hook telemetry to help you monitor agent behavior. Disable with `composto stats --disable` at any time.
```

**Anlatım:**
> "composto init, bitti. PreToolUse hook yazıldı .claude/settings.json'a. Claude Code'u restart ediyoruz — composto artık her Edit/Write öncesi otomatik danışılacak."

**Ekran:** Claude Code restart — pencereyi kapat-aç. `/mcp` komutu ile `composto` green olduğunu göster.

---

## Sahne 3: Agent Composto'suz çalıştırsa... (30 saniye)

**Anlatım:**
> "Önce Composto olmasa ne olurdu görelim — agent'a şunu yazalım:"

**Claude Code'da prompt:**
```
Open scripts/demo-video.ts and refactor the main function to use async/await instead of .then() chains.
```

**Beklenen:** Claude Code bu prompt'a cevap için dosyayı okuyacak, Edit tool çağıracak. **Hook ateşleyecek** çünkü biz az önce init ettik. Agent context'ine `<composto_blastradius>` bloğu enjekte edilecek.

**Ekran annotasyonu:** Hook context'inin agent'a enjekte edildiği anı yakala — konuşma ekranında `<composto_blastradius>` bloğu görünürse screenshot'la highlight et.

**Anlatım:**
> "Agent Edit tool'unu çağırmaya başladı — ama Claude Code dosyayı değiştirmeden önce Composto hook'unu tetikledi. Bakın agent ne aldı:"

**Highlight edilen kısım (ekranda büyüt):**
```
<composto_blastradius>
  file: scripts/demo-video.ts
  verdict: medium
  score: 0.52 confidence: 0.50
  firing_signals: revert_match=1.00, hotspot=0.10, fix_ratio=0.07
  hint: this file's bug history may be relevant to your edit.
</composto_blastradius>
```

---

## Sahne 4: Agent davranış değişimi (30 saniye) — EN ÖNEMLİ ANDIL

**Beklenen:** Agent (Claude) şimdi bu context'i okuyunca proaktif yaklaşmalı. Muhtemel tepkiler:

**İyi tepki (videolanacak ideal yanıt):**
> "I notice this file has been reverted in its history (revert_match strength 1.0). Before I refactor, let me first check what was reverted and why — there may be a reason the original .then() chains are the safer pattern here."

**Beklenmedik tepki alırsan:** Prompt'u `remember this file has a revert history - be careful before refactoring` ile açık yönlendir. Bu daha az organik ama demo için tekrar-çekilebilir kontrollü davranış sağlar.

**Ekran annotasyonu:** Agent'ın bu satırını highlight et. **Bu moment'ı 3-5 saniye still tut** (pause veya zoom) — demo'nun punchline'ı bu.

**Anlatım:**
> "Agent kendi kendine frenledi. 'Bu dosya revert edilmiş, bunu unutma' demedim — hook otomatik söyledi. Ve agent dinledi."

---

## Sahne 5: Telemetri (15 saniye) — "Biraz ötede ne oldu?"

**Komut:**
```bash
composto stats
```

**Beklenen output (minimum):**
```
hook invocations (last 7d):  5+
  by verdict:  medium 20% / low 20% / unknown 40% / passthrough 20%
  by platform: claude-code 5+
  latency:     p50 ~80ms, p95 ~120ms
  cache:       hit rate 0% (cache feature deferred)
```

**Anlatım:**
> "Her edit telemetry'ye yazılıyor. Hepsi local — makinenden çıkmıyor. p95 latency 120 milisaniye — agent neredeyse hiç beklemiyor. `composto stats --disable` ile kapatabilirsin istersen."

---

## Sahne 6: Closing (15 saniye)

**Ekran:** Terminal + README.md açık (VSCode'da) veya sadece siyah ekran + metin.

**Anlatım (voiceover veya kart):**
> "Composto. Coding agent'ının siyah kutusu. Her edit öncesi repo'nun git history'sinden kalibre oluyor. Cloud yok, telemetry yok, account yok. MIT, Claude Code + Cursor + Gemini CLI."
>
> "composto init. Bir komut. Unut."

**Son kart (5 saniye still):**
```
Catches the bug your agent is about to reintroduce.

github.com/mertcanaltin/composto
composto init --client=claude-code
```

---

## Kayıt sonrası

1. Düzenleme: gereksiz bekleme/duraklatmaları kes. 3 dakikanın altında tut.
2. Müzik: YOK (tech demo ciddiyeti). Opsiyonel: minimal ambient background (royalty-free).
3. Alt yazı/caption: EN açık bir tema — anlatım sesli olmayabilir, alt yazı zorunlu.
4. Format: 1080p MP4, H.264. YouTube + Vimeo'ya upload, unlisted tut.
5. Link'i `docs/phase1-dogfood-report.md`'ye ekle.

## Embedding

YouTube unlisted link hazır olunca:
- README'ye embed (thumbnail ile)
- Release notes'a embed
- Tweet'e embed
- HN submission'a link

## Demo sonrası yapılacaklar

- `git restore .composto/memory.db` (eğer yedeklenmişse) — demo invocation'ları test datasından ayrıştır
- Screen recording dosyasını sil (disk space)
- Unlisted link'i özel klasöre kaydet

---

## Tek cümle video-hedefi

> "İzleyici videoyu bitirdiğinde 'agent'ımın davranışını bu değiştirdi, bunu denemek istiyorum' hissetmeli. Başka hiçbir şey değil."
