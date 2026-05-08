# XT-Design-Guideline v1.1
**Hybrid Design System — Carbon × Fluent, Warm Retro Edition**

> Tài liệu chuẩn thiết kế UI/UX cho mọi sản phẩm web/app trong hệ sinh thái XT.
> Chỉ cần tham chiếu file này là dựng được giao diện cơ bản thống nhất, không cần thiết kế lại.

---

## 0. Design DNA

**Engineered, Warm, Slightly Retro.**

XT-Design kế thừa cấu trúc nghiêm ngặt của IBM Carbon (grid, hierarchy, predictability) và độ thân thiện của Fluent (bo góc nhẹ, layering mềm), nhưng thay tông xám lạnh của Carbon bằng **palette xám ấm + giấy ngà** để tạo cảm giác như "tài liệu chuyên môn / sổ tay kỹ thuật" hơn là dashboard SaaS.

Bốn nguyên tắc cốt lõi:

1. **Engineered yet Approachable** — chính xác, có logic, nhưng không cứng. Bo góc nhẹ + đổ bóng có kiểm soát.
2. **Layered Clarity** — phân tầng z-index rõ ràng. Người dùng luôn biết cái gì là background, cái gì là foreground.
3. **Fixed Shell, Fluid Content** — Header và Sidebar cố định. Nội dung bên trong co giãn theo data.
4. **Color-Restraint** — màu được dùng tiết kiệm. Mặc định toàn bộ giao diện ở trạng thái xám-ngà; màu xanh/đỏ/cam chỉ xuất hiện ở điểm cần dẫn dắt mắt.

> **Thuật ngữ ngắn gọn (cho người mới với design system):**
> - *Token*: tên biến đại diện cho 1 giá trị (vd: `--color-primary` = `#4A6AAB`). Đổi giá trị token thì mọi nơi dùng nó đổi theo. Đây là "nguồn sự thật" của design system.
> - *Shell*: bộ khung cố định bao quanh nội dung (header, sidebar).
> - *Elevation*: cảm giác "nổi" của 1 thành phần so với nền — diễn tả bằng shadow.
> - *Semantic color*: màu mang ý nghĩa cố định (success = xanh lá, danger = đỏ…), không dùng cho mục đích trang trí.

---

## 1. Color System

### 1.1. Core Palette (Warm Neutrals)

| Token | Hex | Vai trò chính |
|---|---|---|
| `--color-bg-app` | `#FDFDFC` | Nền chủ đạo của toàn app (giấy ngà). |
| `--color-bg-nav` | `#FDFDFC` | Nền sidebar (light theme — DEFAULT). |
| `--color-surface-1` | `#FFFFFF` | Card, modal, popover (nổi nhẹ trên nền). |
| `--color-surface-2` | `#E7E7E7` | Vùng phụ, divider block, table header bg. |
| `--color-selection` | `#E4E4E3` | Selection / active item trong sidebar, hover row. |
| `--color-hover-soft` | `#EFEEEC` | Hover trung gian giữa app-bg và selection. |
| `--color-border` | `#E0E0E0` | Border mặc định (card, input, divider line). |
| `--color-border-strong` | `#BCBCBC` | Border đậm hơn, scrollbar thumb, separator nhấn. |
| `--color-ink-strong` | `#524F4D` | Nền nút tối màu (dark button), tooltip bg. |

### 1.2. Text

| Token | Hex | Vai trò |
|---|---|---|
| `--color-text-primary` | `#3B3B3B` | Nội dung chính, tiêu đề. |
| `--color-text-secondary` | `#92918D` | Caption, label, placeholder, helper. |
| `--color-text-on-dark` | `#FDFDFC` | Chữ trên nền tối (nút dark, primary, danger). |
| `--color-text-link` | `#485D8D` | Hyperlink, chữ dạng blue trong đoạn văn. |

### 1.3. Brand & Accents (3 vai trò tách bạch)

| Token | Hex | Vai trò | Khi nào dùng |
|---|---|---|---|
| `--color-primary` | `#4A6AAB` | Brand blue — action chính | Nút primary, active indicator sidebar, focus ring, link icon. |
| `--color-primary-hover` | `#3D5994` | — | Hover của primary blue. |
| `--color-accent-retro` | `#C1695B` | Đỏ ấm retro — signature visual | Top-border bar của Top Bar / Section, underline thick, highlight chữ retro. **KHÔNG dùng cho action.** |
| `--color-accent-orange` | `#CC6947` | Cam ấm — CTA mềm | Nút CTA cảm xúc kiểu "Thử ngay", "Khám phá", tag nổi. |

> **Quy tắc dùng accent:** Trong 1 màn hình, **chỉ chọn 1 màu accent dẫn dắt mắt**. Không dùng đồng thời primary blue + accent-retro + accent-orange với cùng cường độ — sẽ phá tinh thần "color-restraint".

### 1.4. Semantic / Status

| Token | Hex | Vai trò |
|---|---|---|
| `--color-success` | `#5A8C5A` | Toast success, badge "đã hoàn thành". (warm green) |
| `--color-warning` | `#C8954A` | Cảnh báo nhẹ, thông tin cần chú ý. (warm amber) |
| `--color-danger` | `#C9534B` | Lỗi, destructive action (Delete, Remove), error state input. |
| `--color-info` | `#4A6AAB` | Toast info, banner thông báo. Trùng `--color-primary`. |

> **Phân biệt 2 màu đỏ:**
> - `--color-danger` (`#C9534B`) — chỉ dùng cho **lỗi / destructive**. Khi user thấy màu này, phải hiểu là "chú ý, có gì đó sai/nguy hiểm".
> - `--color-accent-retro` (`#C1695B`) — chỉ dùng cho **trang trí signature** (top-border, underline đậm, highlight chữ). Không bao giờ gắn vào button hay alert.

### 1.5. Dark Theme (Warm Dark — KHÔNG navy)

> Sidebar light là **default**. Dark theme bật qua attribute `[data-theme="dark"]` ở `<html>`.

| Token | Light | Dark |
|---|---|---|
| `--color-bg-app` | `#FDFDFC` | `#1F1E1C` |
| `--color-bg-nav` | `#FDFDFC` | `#262524` |
| `--color-surface-1` | `#FFFFFF` | `#2D2C2A` |
| `--color-surface-2` | `#E7E7E7` | `#3A3937` |
| `--color-selection` | `#E4E4E3` | `#3F3E3B` |
| `--color-hover-soft` | `#EFEEEC` | `#332F2D` |
| `--color-border` | `#E0E0E0` | `#3A3937` |
| `--color-border-strong` | `#BCBCBC` | `#5A5754` |
| `--color-ink-strong` | `#524F4D` | `#E0DFDB` (đảo vai trò: nền sáng cho dark UI) |
| `--color-text-primary` | `#3B3B3B` | `#ECEBE8` |
| `--color-text-secondary` | `#92918D` | `#A09E99` |
| `--color-text-on-dark` | `#FDFDFC` | `#1F1E1C` |
| `--color-text-link` | `#485D8D` | `#8DA3CF` |
| `--color-primary` | `#4A6AAB` | `#7B92C8` (sáng hơn để contrast trên dark bg) |
| `--color-accent-retro` | `#C1695B` | `#D38476` |
| `--color-accent-orange` | `#CC6947` | `#DA8665` |
| `--color-danger` | `#C9534B` | `#DB7068` |

---

## 2. Typography

### 2.1. Font Stack — 3 lựa chọn (toàn cục)

App phải có 3 font, có sẵn trong **Settings → Typography**, user chọn được. Khi user chọn 1 font, **toàn bộ UI** (heading + body + label + button) đều dùng font đó. **KHÔNG mix font** trong cùng một theme đang active.

| # | Font | Vai trò | Tone |
|---|---|---|---|
| 1 | **Inter** (DEFAULT) | UI tiêu chuẩn | Sạch, neutral hiện đại |
| 2 | **IBM Plex Sans** | Engineering / data view | Kỹ thuật, vuông vắn |
| 3 | **Source Serif 4** | Reading / document view | Retro, có chất "giấy" |

CSS:
```css
--font-sans-default: "Inter", "Segoe UI", system-ui, sans-serif;
--font-sans-engineering: "IBM Plex Sans", "Inter", system-ui, sans-serif;
--font-serif-reading: "Source Serif 4", "Source Serif Pro", Georgia, serif;
--font-mono: "JetBrains Mono", "IBM Plex Mono", Consolas, monospace;
```

### 2.2. Type Scale

| Level | Desktop | Mobile | Weight | Use |
|---|---|---|---|---|
| Display | 32px / 40 lh | 28px | 600 | Trang landing, hero. |
| Page Title | 24px / 32 lh | 22px | 600 | Tiêu đề trang chính. |
| Heading 1 | 20px / 28 lh | 18px | 600 | Section title. |
| Heading 2 | 16px / 24 lh | 16px | 600 | Sub-section, card title. |
| Body | 14px / 20 lh | 16px | 400 | Nội dung chuẩn UI. |
| Body Strong | 14px | 16px | 600 | Nhấn từ khóa. |
| Caption | 12px / 16 lh | 12px | 400 | Helper, timestamp. |
| Code | 13px | 13px | 400 | `--font-mono`. |

### 2.3. Quy tắc

- Heading **không tách font riêng** — luôn theo font đang active. Inter → heading Inter. Serif → heading serif.
- Không dùng letter-spacing rộng kiểu modern startup. Tracking gần 0.
- `font-mono` chỉ dùng cho code block, ID, hash — không dùng cho UI label.

---

## 3. Layout & Spacing

### 3.1. Spacing Scale (4px base)

```
--space-1: 4px    micro gap, icon padding
--space-2: 8px    gap chuẩn giữa các chip, button group
--space-3: 12px   padding nội bộ button, sidebar item
--space-4: 16px   margin lề mobile, gap giữa card
--space-5: 24px   gap section
--space-6: 32px   gap module
--space-7: 48px   page-level breathing room
```

### 3.2. Shell Layout

| Phần | Kích thước | Ghi chú |
|---|---|---|
| Top Bar (Header) | Cao **48px** | Flat, border-bottom 1px `--color-border`. |
| Sidebar Expanded | Rộng **256px** | Light theme, border-right 1px `--color-border`. |
| Sidebar Collapsed | Rộng **48px** | Bắt buộc support thu gọn. |
| Content padding | **24px** desktop / **16px** mobile | Khoảng đệm content area. |

### 3.3. Grid

- Desktop: 12-column, gutter 16px, max-width content 1440px.
- Tablet: 8-column.
- Mobile: 4-column, lề trái/phải 16px.

---

## 4. Radius & Elevation

### 4.1. Corner Radius

| Token | Value | Áp dụng |
|---|---|---|
| `--radius-none` | 0px | Section Tabs (bookmark style), table row. |
| `--radius-sm` | 4px | Buttons, Inputs, Chips, Cards, Sidebar item. |
| `--radius-md` | 6px | Modals, large panels. |
| `--radius-lg` | 8px | Bottom sheet (mobile), top corners only. |
| `--radius-pill` | 999px | Tag tròn dạng badge số (notification count). |

### 4.2. Elevation (Shadow)

| Level | Value | Use |
|---|---|---|
| Flat | `none` | Sidebar, Header, Section Tabs, Table — phẳng tuyệt đối. |
| Light | `0 2px 6px rgba(0,0,0,0.06)` | KPI card, popover, dropdown menu, tooltip. |
| Medium | `0 4px 12px rgba(0,0,0,0.08)` | Sticky panel, side drawer. |
| Deep | `0 8px 24px rgba(0,0,0,0.12)` | Modal, toast, command palette. |

> Shadow ấm hơn Carbon gốc — opacity 0.06–0.12 thay vì 0.08–0.16 để tránh cảm giác "lạnh".

---

## 5. Brand Mark

### 5.1. Logo XT — Spec

- **Vị trí mặc định:** góc trái Top Bar, vertical-center.
- **Kích thước:** chiều cao logo 24px (desktop), 20px (mobile). Logo + wordmark "XT" dùng font `--font-sans-default` weight 600, 16px, đặt phải logo, gap 8px.
- **Clearspace:** vùng trống xung quanh logo tối thiểu = ½ chiều cao logo (12px) — không đặt element khác chen vào vùng này.
- **Min-size:**
  - Standalone mark (chỉ symbol): tối thiểu 16×16px.
  - Mark + wordmark: tối thiểu 64px chiều ngang.
- **Màu logo:**
  - Light theme: dùng `--color-text-primary` (`#3B3B3B`) hoặc `--color-ink-strong` (`#524F4D`).
  - Dark theme: dùng `--color-text-primary` (đảo về `#ECEBE8`).
  - **Không** dùng primary blue hay accent cho logo — giữ neutral.
- **Optional retro touch:** đặt 1 thanh `--color-accent-retro` 2px ở **top-border của Top Bar** (full width) làm signature đặc trưng XT. Áp dụng cho landing page và module signature.

### 5.2. Don't

- Không xoay, nghiêng, làm gradient logo.
- Không đặt logo trên ảnh nền có chi tiết (cần overlay solid).
- Không dùng wordmark riêng nếu thiếu mark.

---

## 6. Iconography (Phosphor)

- **Bộ icon:** [Phosphor Icons](https://phosphoricons.com/), variant **Regular** (stroke 1.5px). Không dùng Bold/Fill/Duotone trong UI chính (chỉ dùng Fill cho tab active mobile khi cần).
- **Khung icon:** 20×20px (UI mặc định), 24×24px (sidebar collapsed, top bar), 16×16px (inline với text body).
- **Màu mặc định:** `--color-text-secondary`. Active: `--color-text-primary`. Destructive: `--color-danger`. Trên nền tối: `--color-text-on-dark`.
- **Icon-only button** bắt buộc có `aria-label`.
- **Không trộn** Phosphor với Lucide / Material / Feather trong cùng app.

---

## 7. Component Specs

### 7.1. Sidebar (Light — DEFAULT)

- Nền: `--color-bg-nav` (`#FDFDFC`).
- Border phải: 1px `--color-border`.
- **Active item:** bg `--color-selection`, bar dọc trái 4px `--color-primary`, text/icon `--color-text-primary`.
- **Hover item:** bg `--color-hover-soft`.
- Item padding: 12px 16px. Radius 4px. Gap 2px giữa các item.
- Icon: 20×20px Phosphor Regular.

### 7.2. Top Bar

- Cao 48px, flat, border-bottom 1px `--color-border`.
- **Trái:** Logo XT + wordmark.
- **Phải:** Search icon → Notifications → Profile avatar. Touch target 32×32px desktop / 48×48px mobile.
- Optional: top-border 2px `--color-accent-retro` (signature retro).

### 7.3. Buttons

| Variant | Bg | Text | Border | Use |
|---|---|---|---|---|
| Primary | `--color-primary` | `--color-text-on-dark` | none | Action chính 1 màn hình. |
| Secondary | `transparent` | `--color-text-primary` | 1px `--color-border-strong` | Action phụ. |
| Tertiary (Ghost) | `transparent` | `--color-primary` | none | Link-style action. |
| Dark | `--color-ink-strong` | `--color-text-on-dark` | none | Khi cần nút tối ấm (dùng tiết kiệm). |
| Accent | `--color-accent-orange` | `--color-text-on-dark` | none | CTA cảm xúc. |
| Danger | `--color-danger` | `--color-text-on-dark` | none | Destructive (Delete, Remove). |

- **Sizing:** Small 32px / Default 40px / Mobile 48px.
- **Radius:** 4px. **Shadow:** none.
- **Padding ngang:** 16px (default), 12px (small), 20px (mobile).
- **Disabled:** opacity 0.4, `cursor: not-allowed`.

### 7.4. Inputs

- Cao 40px, border 1px `--color-border`, radius 4px, bg `--color-surface-1`.
- **Hover:** border `--color-border-strong`.
- **Focus:** border 1.5px `--color-primary`, outline 2px `rgba(74,106,171,0.25)`.
- **Error:** border `--color-danger`, helper text `--color-danger`.
- Placeholder: `--color-text-secondary`.
- **Disabled:** bg `#F5F5F4`, text `--color-text-secondary`, cursor not-allowed.

### 7.5. Section Tabs (Bookmark)

- Radius **0px**.
- Active: top-border 2px `--color-primary`, bg `--color-surface-1`, nối liền block content.
- Module signature: thay top-border thành 2px `--color-accent-retro`.
- Inactive: bg `--color-bg-app`, text `--color-text-secondary`.

### 7.6. Switcher Chips (Segmented)

- Radius 4px, **gap 6px** giữa chip.
- Default: bg transparent, border 1px `--color-border`, text `--color-text-primary`.
- Active: bg `--color-primary`, text `--color-text-on-dark`.
- Cao 32px, padding ngang 12px.

### 7.7. Cards & Panels

- Bg `--color-surface-1`.
- Border 1px `--color-border` HOẶC shadow-light — **chỉ chọn 1**.
- Radius 4px, padding 16px (default) / 24px (large).

### 7.8. Modals

- Radius 6px, shadow-deep.
- Overlay: `rgba(0,0,0,0.5)`.
- Header border-bottom 1px `--color-border`, padding 20px.
- Footer action căn phải, gap 8px.
- Mobile: Bottom Sheet, radius 8px 2 góc trên, drag handle 32×4px màu `--color-border-strong`.

### 7.9. Tables

- Header bg `--color-surface-2`, text `--color-text-primary` 13/600.
- Row border-bottom 1px `--color-border`.
- Row hover bg `--color-hover-soft`.
- Selected row: left-bar 3px `--color-primary` + bg `rgba(74,106,171,0.06)`.
- Padding cell: 12px ngang, 10px dọc. Radius 0px.

### 7.10. Scrollbar

- Track: transparent.
- Thumb: `--color-border-strong` (`#BCBCBC`), radius 999px, width 8px.
- Hover thumb: `--color-text-secondary`.

### 7.11. Toasts

- Vị trí: top-right desktop, top-center mobile.
- Radius 4px, shadow-deep.
- Border-left 4px theo semantic (success/warning/danger/info).
- Bg `--color-surface-1`, padding 12px 16px.
- Auto-dismiss 5s (info/success), 7s (warning/danger).

### 7.12. Tooltip ⭐ NEW

- Bg `--color-ink-strong` (`#524F4D`), text `--color-text-on-dark`, font 12px / 16 lh.
- Padding 6px 10px, radius 4px, shadow-light.
- Arrow 6px, cùng màu bg.
- Delay show 400ms, hide 100ms.
- Max-width 240px, text wrap.
- **Light variant** (khi tooltip nằm trong vùng nền tối): bg `--color-surface-1`, border 1px `--color-border`, text `--color-text-primary`.

### 7.13. Breadcrumb ⭐ NEW

- Font 13px, color `--color-text-secondary` cho item past, `--color-text-primary` cho item current.
- Separator: ký tự `/` hoặc icon Phosphor `CaretRight` 14px, màu `--color-text-secondary`, padding ngang 8px.
- Item past: hover → text `--color-text-link`, underline.
- Item current: bold 600, không clickable.
- Max chiều dài: nếu quá 4 cấp → collapse giữa thành `...` (dropdown khi click).

### 7.14. Pagination ⭐ NEW

- Style: chip-numeric.
- Cao 32px, width tối thiểu 32px (square cho số đơn), radius 4px.
- Default: bg transparent, border 1px `--color-border`, text `--color-text-primary`.
- Hover: bg `--color-hover-soft`.
- **Active page:** bg `--color-primary`, text `--color-text-on-dark`, không border.
- Prev/Next: icon Phosphor `CaretLeft`/`CaretRight`, cùng style chip nhưng width 32px.
- Disabled (đầu/cuối list): opacity 0.4.
- Gap giữa chip: 4px.
- Optional: bên phải hiển thị "Trang 3 / 24" font 13px `--color-text-secondary`.

### 7.15. Empty State ⭐ NEW

- **Layout dọc, căn giữa:**
  - Illustration / icon Phosphor 48×48px, màu `--color-border-strong`.
  - Title: 16px / 600, `--color-text-primary`, margin-top 16px.
  - Description: 14px / 400, `--color-text-secondary`, max-width 360px, margin-top 8px.
  - CTA Button (optional): primary hoặc accent-orange tùy ngữ cảnh, margin-top 16px.
- Vùng container: padding 48px 24px tối thiểu.
- Không dùng emoji hay illustration màu mè — giữ neutral.

### 7.16. Skeleton Loader ⭐ NEW

- Bg base: `--color-surface-2` (`#E7E7E7`).
- Shimmer animation: gradient từ `#E7E7E7` → `#EFEEEC` → `#E7E7E7`, duration 1.4s linear infinite.
- Radius khớp với element thật:
  - Skeleton text line: cao 12px, radius 4px.
  - Skeleton heading: cao 20px, radius 4px.
  - Skeleton avatar: tròn 40×40px, radius 999px.
  - Skeleton card: theo card thật.
- Khi `prefers-reduced-motion: reduce`: tắt shimmer, giữ bg tĩnh `--color-surface-2`.

CSS gợi ý:
```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, #E7E7E7 0%, #EFEEEC 50%, #E7E7E7 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
}
```

### 7.17. Date Picker ⭐ NEW

**Trigger (input):** style giống Input chuẩn (mục 7.4), thêm icon `Calendar` Phosphor 16px ở phải, padding-right 36px.

**Calendar dropdown:**
- Bg `--color-surface-1`, border 1px `--color-border`, radius 6px, shadow-light, padding 12px.
- Header: tháng + năm (16/600, `--color-text-primary`), 2 nút prev/next icon-only 28×28px.
- Weekday row: 12/600, `--color-text-secondary`, uppercase.
- Day cell: 32×32px, radius 4px, font 13px.
  - Default: text `--color-text-primary`.
  - Khác tháng: text `--color-text-secondary`, opacity 0.5.
  - Hover: bg `--color-hover-soft`.
  - **Today:** border 1px `--color-accent-retro` (signature touch — đánh dấu hôm nay).
  - **Selected:** bg `--color-primary`, text `--color-text-on-dark`, font 600.
  - **In-range** (range picker): bg `rgba(74,106,171,0.1)`, text `--color-text-primary`.
  - **Disabled:** opacity 0.3, cursor not-allowed.
- Footer (optional): "Today" + "Clear" button tertiary.

### 7.18. Notification Badge ⭐ NEW

- Bg `--color-danger` (`#C9534B`), text `--color-text-on-dark`, font 11px / 600.
- Hình tròn (radius pill 999px), min-size 16×16px, padding ngang 4px (cho số 2 chữ số).
- Vị trí: top-right của icon parent, offset `-2px -2px` (lệch ra ngoài 1 chút).
- Khi count > 99: hiển thị `99+`.
- Khi count = 0: ẩn hoàn toàn (không hiện badge "0").
- **Dot variant** (chỉ báo "có cái mới", không cần số): chấm tròn 8×8px màu `--color-danger`, không text.
- Dùng `--color-danger` (không phải accent-retro) theo quy ước phổ thông: đỏ = "chú ý ngay".

---

## 8. States Matrix (tổng hợp)

| Component | Default | Hover | Active/Selected | Focus | Disabled |
|---|---|---|---|---|---|
| Button Primary | bg `#4A6AAB` | bg `#3D5994` | bg `#3D5994` + inset shadow | outline 2px `rgba(74,106,171,0.25)` | opacity 0.4 |
| Button Secondary | border `#BCBCBC` | bg `#E4E4E3` | bg `#E0E0E0` | outline ring | opacity 0.4 |
| Sidebar item | text `#92918D` | bg `#EFEEEC` | bg `#E4E4E3` + bar 4px primary | outline | text opacity 0.4 |
| Input | border `#E0E0E0` | border `#BCBCBC` | — | border `#4A6AAB` 1.5px | bg `#F5F5F4` |
| Chip | border `#E0E0E0` | bg `#E4E4E3` | bg primary, text white | outline | opacity 0.4 |
| Pagination | border `#E0E0E0` | bg `#EFEEEC` | bg primary, text white | outline | opacity 0.4 |
| Day cell | text primary | bg `#EFEEEC` | bg primary, text white | outline | opacity 0.3 |

---

## 9. Mobile Guidelines

- Touch target **tối thiểu 48×48px** cho mọi element tương tác.
- Lề trái/phải content: 16px.
- Sidebar → drawer trượt từ trái, overlay full màn hình.
- Section Tabs: cho phép horizontal scroll, fade gradient ở mép phải.
- Modal → Bottom Sheet, radius 8px 2 góc trên, drag handle.
- Body text 16px (tăng từ 14px desktop).

---

## 10. Accessibility

- **Contrast WCAG AA:** body 4.5:1, text lớn ≥18px là 3:1.
  - `#3B3B3B` trên `#FDFDFC` → ~10.8:1 ✅
  - `#92918D` trên `#FDFDFC` → ~3.5:1 ⚠️ (chỉ dùng cho text lớn / caption non-critical).
- **Focus indicator:** luôn hiện rõ — không xóa outline. Outline 2px `rgba(74,106,171,0.4)` offset 2px.
- **Keyboard navigation:** mọi action reach được bằng Tab.
- **Reduced motion:** khi `prefers-reduced-motion: reduce`, tắt animation/shimmer/transition ngoài 100ms.
- **Icon-only button:** bắt buộc `aria-label`.
- **Color không phải tín hiệu duy nhất:** error đỏ phải kèm icon hoặc text "Error".

---

## 11. Motion

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 120ms ease-out | Hover, button press. |
| `--motion-base` | 200ms ease-out | Sidebar collapse, dropdown, tooltip. |
| `--motion-slow` | 320ms cubic-bezier(0.2, 0.8, 0.2, 1) | Modal enter/exit, page transition. |

Không dùng bounce, elastic, spring. `ease-out` cho enter, `ease-in` cho exit.

---

## 12. CSS Tokens (Production-ready)

```css
:root,
[data-theme="light"] {
  /* === Surfaces === */
  --color-bg-app: #FDFDFC;
  --color-bg-nav: #FDFDFC;
  --color-surface-1: #FFFFFF;
  --color-surface-2: #E7E7E7;
  --color-selection: #E4E4E3;
  --color-hover-soft: #EFEEEC;

  /* === Borders === */
  --color-border: #E0E0E0;
  --color-border-strong: #BCBCBC;

  /* === Ink === */
  --color-ink-strong: #524F4D;

  /* === Text === */
  --color-text-primary: #3B3B3B;
  --color-text-secondary: #92918D;
  --color-text-on-dark: #FDFDFC;
  --color-text-link: #485D8D;

  /* === Brand & Accents === */
  --color-primary: #4A6AAB;
  --color-primary-hover: #3D5994;
  --color-accent-retro: #C1695B;
  --color-accent-orange: #CC6947;

  /* === Semantic === */
  --color-success: #5A8C5A;
  --color-warning: #C8954A;
  --color-danger: #C9534B;
  --color-info: #4A6AAB;
}

[data-theme="dark"] {
  --color-bg-app: #1F1E1C;
  --color-bg-nav: #262524;
  --color-surface-1: #2D2C2A;
  --color-surface-2: #3A3937;
  --color-selection: #3F3E3B;
  --color-hover-soft: #332F2D;

  --color-border: #3A3937;
  --color-border-strong: #5A5754;

  --color-ink-strong: #E0DFDB;

  --color-text-primary: #ECEBE8;
  --color-text-secondary: #A09E99;
  --color-text-on-dark: #1F1E1C;
  --color-text-link: #8DA3CF;

  --color-primary: #7B92C8;
  --color-primary-hover: #94A8D6;
  --color-accent-retro: #D38476;
  --color-accent-orange: #DA8665;

  --color-success: #7DAE7D;
  --color-warning: #DBAB6A;
  --color-danger: #DB7068;
  --color-info: #7B92C8;
}

:root {
  /* === Radii === */
  --radius-none: 0px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-pill: 999px;

  /* === Shadows === */
  --shadow-flat: none;
  --shadow-light: 0 2px 6px rgba(0, 0, 0, 0.06);
  --shadow-medium: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-deep: 0 8px 24px rgba(0, 0, 0, 0.12);

  /* === Spacing === */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;

  /* === Shell === */
  --shell-header-h: 48px;
  --shell-sidebar-w: 256px;
  --shell-sidebar-w-collapsed: 48px;

  /* === Typography === */
  --font-sans-default: "Inter", "Segoe UI", system-ui, sans-serif;
  --font-sans-engineering: "IBM Plex Sans", "Inter", system-ui, sans-serif;
  --font-serif-reading: "Source Serif 4", "Source Serif Pro", Georgia, serif;
  --font-mono: "JetBrains Mono", "IBM Plex Mono", Consolas, monospace;

  /* === Motion === */
  --motion-fast: 120ms ease-out;
  --motion-base: 200ms ease-out;
  --motion-slow: 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* Font switch — toàn bộ UI dùng cùng 1 font */
[data-font="inter"]  { --font-active: var(--font-sans-default); }
[data-font="plex"]   { --font-active: var(--font-sans-engineering); }
[data-font="serif"]  { --font-active: var(--font-serif-reading); }

body {
  font-family: var(--font-active, var(--font-sans-default));
  background: var(--color-bg-app);
  color: var(--color-text-primary);
}
```

---

## 13. Do / Don't

**DO**
- Giữ giao diện chủ yếu ở tông xám-ngà. Để màu xuất hiện như "điểm nhấn", không phải trang trí.
- Dùng `--color-accent-retro` ở top-bar/underline làm signature đặc trưng XT.
- Cho user chọn font và theme trong Settings.
- Border HOẶC shadow — không dùng cả 2 cho cùng 1 element.
- Phân biệt rõ: `--color-danger` cho lỗi, `--color-accent-retro` cho trang trí.

**DON'T**
- Không trộn font giữa heading/body — toàn UI cùng 1 font.
- Không dùng đồng thời 3 màu accent (blue + retro + orange) ở cùng 1 màn hình.
- Không bo góc quá lớn (>8px) — phá tinh thần engineered.
- Không gradient nền — giữ flat.
- Không emoji trong UI label.
- Không drop-shadow neon kiểu glassmorphism.
- Không trộn icon set khác với Phosphor.

---

## 14. Versioning

| Version | Date | Note |
|---|---|---|
| v1.0 | 2026-05-02 | Bản đầu — palette warm, light sidebar default, 3-font system. |
| v1.1 | 2026-05-02 | Tách `accent-retro` (#C1695B) khỏi `danger` (#C9534B); dark theme đầy đủ; thêm Brand Mark; chốt Phosphor; bổ sung Tooltip / Breadcrumb / Pagination / Empty State / Skeleton / Date Picker. |

---
