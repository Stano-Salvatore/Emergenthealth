import { signIn } from "@/auth"

export default function MobileSignIn() {
  async function doSignIn() {
    "use server"
    await signIn("google", { redirectTo: "/api/mobile-auth-bridge" })
  }

  return (
    <form action={doSignIn} id="f">
      <button type="submit" style={{ display: "none" }} />
      <script dangerouslySetInnerHTML={{ __html: 'document.getElementById("f").submit()' }} />
    </form>
  )
}
