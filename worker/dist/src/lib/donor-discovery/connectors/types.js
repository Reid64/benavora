"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECISION_MAKER_TITLE_KEYWORDS = void 0;
exports.isDecisionMakerTitle = isDecisionMakerTitle;
/** Job title substrings (case-insensitive) both connectors filter to — the task's "decision-maker" list, shared so it can't drift between providers. */
exports.DECISION_MAKER_TITLE_KEYWORDS = [
    "ceo",
    "chief executive",
    "executive director",
    "president",
    "director",
    "manager",
    "csr",
    "corporate social responsibility",
    "development",
    "donor",
    "giving",
    "philanthropy",
];
function isDecisionMakerTitle(title) {
    if (!title)
        return false;
    const lower = title.toLowerCase();
    return exports.DECISION_MAKER_TITLE_KEYWORDS.some((keyword) => lower.includes(keyword));
}
