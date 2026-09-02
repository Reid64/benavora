# SPEC_TRIM_LENGTH_OPTIMIZER.md
## AFS — Trim Length Optimizer
**Phase 2 — Embedded in Auto Material Calculator**
**BLOCKED: Standard stock lengths pending checklist #21**

---

## 1. WHAT THIS IS

The Trim Length Optimizer calculates the most efficient cut list when an order
can be fulfilled from AFS standard stock lengths. It shows the contractor how
many full-length pieces they will receive and what the off-cut waste will be.

This is informational and operational — it helps the contractor plan installation
sequences and helps AFS fabrication plan cut schedules. No pricing involved.

---

## 2. ALGORITHM

```typescript
interface StockCutResult {
  stockLengthFt:    number;
  piecesOrdered:    number;
  totalStockFt:     number;
  cutList:          CutPiece[];
  wastePercent:     number;
  wasteLinearFt:    number;
}

interface CutPiece {
  pieceNumber:         number;
  lengthFt:            number;
  remainderFt:         number;
  cuttingInstructions: string;
}

function optimizeTrimLength(
  neededLf:         number,
  stockLengthFt:    number,
  kerfAllowanceFt:  number = 0.0208  // ~1/4 inch blade width
): StockCutResult {
  const usableLengthFt = stockLengthFt - kerfAllowanceFt;
  const piecesNeeded = Math.ceil(neededLf / usableLengthFt);
  const totalStockFt = piecesNeeded * stockLengthFt;
  const wasteLinearFt = totalStockFt - neededLf;
  const wastePercent = (wasteLinearFt / totalStockFt) * 100;

  // Build cut list — simple sequential assignment
  let remainingNeeded = neededLf;
  const cutList: CutPiece[] = [];
  for (let i = 0; i < piecesNeeded; i++) {
    const thisLength = Math.min(remainingNeeded, usableLengthFt);
    const remainder = usableLengthFt - thisLength;
    cutList.push({
      pieceNumber: i + 1,
      lengthFt: Math.round(thisLength * 100) / 100,
      remainderFt: Math.round(remainder * 100) / 100,
      cuttingInstructions: remainder > 0.5
        ? `Cut to ${thisLength.toFixed(2)} ft — ${remainder.toFixed(2)} ft remainder`
        : `Full length`
    });
    remainingNeeded -= thisLength;
  }

  return { stockLengthFt, piecesOrdered: piecesNeeded, totalStockFt, cutList, wastePercent, wasteLinearFt };
}
```

---

## 3. UI DISPLAY

```
TrimLengthOptimizerSection (collapsible, within AutoMaterialCalculator)
Only shown when product has standard stock lengths defined.

"You need 47 LF. We stock this profile in 10 ft lengths."

┌─────────────────────────────────────────┐
│ OPTIMIZED CUT LIST                      │
│ 5 pieces × 10 ft = 50 ft stock ordered  │
│ Waste: 3 LF (6%)                        │
│                                         │
│ Piece 1: 10 ft (full length)            │
│ Piece 2: 10 ft (full length)            │
│ Piece 3: 10 ft (full length)            │
│ Piece 4: 10 ft (full length)            │
│ Piece 5: 7 ft (3 ft off-cut)           │
└─────────────────────────────────────────┘
```

---

*SPEC_TRIM_LENGTH_OPTIMIZER.md | AFS | Reid Whitesides | June 2026*
