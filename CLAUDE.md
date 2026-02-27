# McDonald's Optimizer

找出最便宜的麥當勞點餐組合。純靜態網站，部署在 GitHub Pages。

## 架構

```
scraper/          # Python 爬蟲，產出 data/*.yaml
  scrape.py       # 爬 cpok.tw → 結構化 YAML
  requirements.txt
data/             # 菜單 & 優惠資料 (YAML, git tracked)
  menu.yaml       # 品項 + 價格
  promotions.yaml # 優惠規則
site/             # 純靜態網頁 → GitHub Pages
  index.html
  optimizer.js    # 最佳化演算法（瀏覽器端）
  app.js          # UI 邏輯
docs/
```

## 資料更新流程

```
跑 scraper → data/*.yaml 更新 → git commit & push → GitHub Pages 部署
```

## 核心邏輯

使用者勾選品項 + 數量 → 瀏覽器端計算：
1. **精確覆蓋**：滿足所有品項的最低價組合
2. **邊際升級**：多花一點能多拿什麼（≤130 定額 +50，>130 加 30%）

## 優惠規則類型

| type | 說明 |
|------|------|
| `combo` | 固定品項組合 = 固定價（套餐） |
| `pick_combo` | A群選一 + B群選一 = 固定價（1+1） |
| `buy_a_get_b_free` | 買A群原價，送B群一個（甜心卡）— 雙向 |
| `second_half_price` | 第二件半價 |
| `addon` | 套餐內加購價 |
| `fixed_price` | 指定品項特價 |
| `discount` | 滿額折扣 |

## 開發

```bash
# 爬蟲
cd scraper && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# 靜態網頁本地測試
cd site && python3 -m http.server 8000
```
