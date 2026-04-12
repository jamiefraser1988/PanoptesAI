import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          <img src={`${basePath}/logo.png`} alt="PanoptesAI" className="w-8 h-8 object-contain drop-shadow-[0_0_8px_rgba(56,189,248,0.25)]" />
          <Link href="/">
            <h1 className="font-bold text-lg tracking-tight cursor-pointer">
              <span className="text-primary">Panoptes</span>AI
            </h1>
          </Link>
        </div>
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1 min-h-[44px]">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </Link>
      </header>

      <main className="flex-1 px-4 md:px-6 py-8 md:py-12 max-w-4xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 12, 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Introduction</h2>
            <p>PanoptesAI ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our AI-powered Reddit moderation platform at panoptesai.net ("the Service").</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Information We Collect</h2>
            <h3 className="text-base font-medium text-foreground mt-3 mb-1">Account Information</h3>
            <p>When you create an account, we collect your email address, display name, and authentication credentials managed through our authentication provider (Clerk).</p>

            <h3 className="text-base font-medium text-foreground mt-3 mb-1">Reddit Data</h3>
            <p>When you connect subreddits for monitoring, we process publicly available Reddit content including:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Post titles, body text, and metadata</li>
              <li>Comment text and metadata</li>
              <li>Author usernames and public account information</li>
              <li>Subreddit information</li>
            </ul>
            <p className="mt-2">This data is processed for the purpose of generating risk scores and moderation insights. We access this data through Reddit's official Devvit platform and API.</p>

            <h3 className="text-base font-medium text-foreground mt-3 mb-1">Usage Data</h3>
            <p>We collect information about how you interact with the Service, including moderation actions taken, configuration settings, and feature usage.</p>

            <h3 className="text-base font-medium text-foreground mt-3 mb-1">Technical Data</h3>
            <p>We automatically collect technical information such as IP address, browser type, device information, and access times for security and analytics purposes.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How We Use Your Information</h2>
            <p>We use the collected information to:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Provide, maintain, and improve the Service</li>
              <li>Generate risk scores and moderation recommendations</li>
              <li>Display analytics and trends across monitored subreddits</li>
              <li>Send you notifications about flagged content (if configured)</li>
              <li>Respond to your inquiries and support requests</li>
              <li>Detect and prevent fraud, abuse, or security incidents</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Data Storage and Retention</h2>
            <p>Your data is stored securely on servers managed by our hosting provider. We retain your account information for as long as your account is active. Reddit content processed for scoring is retained for analytics purposes and can be deleted upon request. Configuration data is retained until you delete it or close your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Data Sharing</h2>
            <p>We do not sell your personal information. We may share your information with:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Service Providers:</strong> Third-party services that help us operate the Service (hosting, authentication, analytics)</li>
              <li><strong>Reddit:</strong> Through the Devvit platform for app functionality</li>
              <li><strong>Legal Requirements:</strong> When required by law, court order, or governmental authority</li>
              <li><strong>Safety:</strong> To protect the rights, safety, or property of PanoptesAI, our users, or others</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Data Security</h2>
            <p>We implement appropriate technical and organizational measures to protect your information, including encryption in transit (TLS/SSL), secure authentication, and access controls. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Your Rights</h2>
            <p>Depending on your location, you may have the following rights regarding your personal data:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
              <li><strong>Correction:</strong> Request correction of inaccurate personal data</li>
              <li><strong>Deletion:</strong> Request deletion of your personal data</li>
              <li><strong>Portability:</strong> Request a machine-readable copy of your data</li>
              <li><strong>Objection:</strong> Object to processing of your personal data</li>
              <li><strong>Withdrawal of Consent:</strong> Withdraw consent where processing is based on consent</li>
            </ul>
            <p className="mt-2">To exercise these rights, contact us at <a href="mailto:privacy@panoptesai.net" className="text-primary hover:underline">privacy@panoptesai.net</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Cookies and Tracking</h2>
            <p>The Service uses essential cookies for authentication and session management. We do not use third-party advertising cookies. Analytics cookies may be used to understand Service usage and improve performance.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Children's Privacy</h2>
            <p>The Service is not intended for users under the age of 13 (or the applicable age of digital consent in your jurisdiction). We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will take steps to delete it promptly.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. International Data Transfers</h2>
            <p>Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place for such transfers in accordance with applicable data protection laws.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on the Service with a new "Last updated" date. Your continued use of the Service after changes constitutes your acceptance of the updated policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Contact Us</h2>
            <p>If you have questions or concerns about this Privacy Policy or our data practices, please contact us at:</p>
            <p className="mt-2">
              <a href="mailto:privacy@panoptesai.net" className="text-primary hover:underline">privacy@panoptesai.net</a>
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border px-4 md:px-6 py-4 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-4">
          <Link href="/terms" className="hover:text-primary transition-colors">Terms and Conditions</Link>
          <span>&copy; {new Date().getFullYear()} PanoptesAI. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
