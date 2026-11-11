// Dip-buying BTC trading bot for make.fun btc-race-24h-20261111-0801
// Strategy v2: Buy dips off a 2-hour anchor with reversal confirmation.
// Why v2 beats v1 (30-bar anchor, 1.0% dip, TP/SL 0.8%): on the dev window the
// price fell ~1.9% in the first half then recovered steadily in the second half
// with NO 1% dip from a 30-bar high at all, so v1 sat in cash for 720 bars
// and made only 2 trades. A 120-bar high still sees those dips, and a
// shallower 0.7% dip threshold catches more bounces, so v2 trades in both
// halves of the window (5 trades, +$19.43 official dev grade, max DD 1.0%,
// vs v1 +$6.99, 2 trades). A first v2 try (360-bar, TP/SL 1.0%) graded
// -$3.31 officially and was rejected, not submitted: its wider targets let
// a winner reverse into a stop loss. TP/SL stay at 0.8% here.
// - Track the highest price in the last 120 bars (2 hours)
// - Buy when price has dropped >0.7% from that high AND risen for 2 consecutive bars
// - Sell at +0.8% profit target or -0.8% stop loss
// - Long only, single position

import { BPS, runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK_BARS = 120;     // 2-hour lookback for high
const DIP_THRESHOLD_BPS = 70;  // Buy after >0.7% drop from 120-bar high
const PROFIT_TARGET_BPS = 80;  // Sell at +0.8% from entry
const STOP_LOSS_BPS = 80;      // Sell at -0.8% from entry
const REVERSAL_BARS = 2;       // Consecutive up bars confirming the bounce
const MAX_SLIPPAGE_BPS = 100;

const closes: number[] = [];
let upBars = 0; // consecutive up bars
let prevClose: number | null = null;

await runBars({
  onBatch(state, batch) {
    const orders: (BuyInput | SellInput)[] = [];
    const bar = batch.bars.find(b => b.symbol === SYMBOL);
    if (!bar) return orders;

    const close = Number(bar.c) / 1e5;
    closes.push(close);
    if (closes.length > LOOKBACK_BARS + 10) closes.shift();

    // Count consecutive up bars
    if (prevClose !== null) {
      if (close > prevClose) upBars++;
      else upBars = 0;
    }
    prevClose = close;

    if (closes.length < LOOKBACK_BARS) return orders;

    const window = closes.slice(-LOOKBACK_BARS);
    let high = -Infinity;
    for (const c of window) if (c > high) high = c;

    // Drop from 360-bar high in bps
    const dropBps = Math.round(((high - close) / high) * 10000);

    const held = state.positions.get(SYMBOL);

    if (held !== undefined) {
      const currentValue = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      const profitTarget = (cost * (BPS + BigInt(PROFIT_TARGET_BPS))) / BPS;
      const stopLoss = (cost * (BPS - BigInt(STOP_LOSS_BPS))) / BPS;
      if (currentValue >= profitTarget || currentValue <= stopLoss) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    } else if (dropBps >= DIP_THRESHOLD_BPS && upBars >= REVERSAL_BARS) {
      // Significant dip from 6-hour high, with 2 consecutive up bars (reversal)
      const { caps } = state.hello;
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
      let slice = state.cash < byWeight ? state.cash : byWeight;
      const { fees } = state.hello;
      if (slice >= BigInt(fees.min_notional_quote_units) && slice > 0n) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }

    return orders;
  },
});
