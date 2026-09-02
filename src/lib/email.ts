// The one sender for every transactional email.
//
// Resend's shared sandbox address (onboarding@resend.dev) delivers only to the
// Resend account's owner. Seven routes had it pasted in, so every other user's
// digest, review and export "sent" and then failed silently at the provider.
// Set EMAIL_FROM to a sender on a domain verified in Resend.
export const EMAIL_FROM = process.env.EMAIL_FROM?.trim() || "Emergenthealth <onboarding@resend.dev>"
