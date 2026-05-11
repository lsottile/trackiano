# Code Review Rules

## General
- ES modules only (import/export), no CommonJS
- No unused variables or imports
- Prefer async/await over callbacks or raw promises

## JavaScript
- Use const by default, let only when reassignment is needed
- Optional chaining (?.) and nullish coalescing (??) over manual null checks
- No var

## Bot (grammy)
- Always return ctx.reply() to short-circuit handlers early
- Commands must validate input before calling Notion

## Notion
- All database queries go through notion.js — no direct client calls in bot.js
- Property access always uses optional chaining with fallback (e.g. ?? '')
