import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = {
  title: "Reset Password — VYRON FINANCE",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-vf-canvas px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardContent className="p-8 sm:p-10">
          <Link href="/" className="mb-8 flex items-center gap-2.5 font-display text-lg text-vf-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-vf-charcoal">
              <BrandMark className="h-4 w-4" />
            </span>
            VYRON FINANCE
          </Link>

          <h1 className="text-2xl font-medium text-vf-ink">Reset your password</h1>
          <p className="mt-1.5 text-sm text-vf-ink-soft">
            We&rsquo;ll email you a link to choose a new one.
          </p>

          <div className="mt-8">
            <ForgotPasswordForm />
          </div>

          <p className="mt-6 text-center text-sm text-vf-ink-faint">
            <Link href="/login" className="font-medium text-vf-red-600 hover:underline">
              Back to login
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
