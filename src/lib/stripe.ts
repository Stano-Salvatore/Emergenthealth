import Stripe from "stripe"

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-05-27.dahlia" as "2026-05-27.dahlia" })
  : null

export const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? ""
export const STRIPE_PRO_ANNUAL_PRICE_ID = process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? ""

export function isStripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRO_PRICE_ID
}
