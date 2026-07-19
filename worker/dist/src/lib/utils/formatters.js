"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCurrency = formatCurrency;
exports.formatDate = formatDate;
exports.formatRelative = formatRelative;
exports.decodeHtmlEntities = decodeHtmlEntities;
exports.humanizeEnum = humanizeEnum;
const date_fns_1 = require("date-fns");
/** Format a number as USD currency. Returns an em dash for null/undefined. */
function formatCurrency(amount) {
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
        return "-";
    }
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(amount);
}
/** Format a date (or ISO string) as e.g. "Jun 8, 2026". */
function formatDate(value) {
    if (!value)
        return "-";
    const date = typeof value === "string" ? new Date(value) : value;
    if (!(0, date_fns_1.isValid)(date))
        return "-";
    return (0, date_fns_1.format)(date, "MMM d, yyyy");
}
/** Relative time, e.g. "3 days ago". */
function formatRelative(value) {
    if (!value)
        return "-";
    const date = typeof value === "string" ? new Date(value) : value;
    if (!(0, date_fns_1.isValid)(date))
        return "-";
    return (0, date_fns_1.formatDistanceToNow)(date, { addSuffix: true });
}
/** Decode HTML entities inserted by external APIs (e.g. &amp; → &, &#39; → '). */
function decodeHtmlEntities(text) {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)));
}
/** Convert a snake_case enum value to a human label, e.g. "private_foundation" -> "Private Foundation". */
function humanizeEnum(value) {
    if (!value)
        return "-";
    return value
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}
