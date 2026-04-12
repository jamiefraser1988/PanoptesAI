import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Terms() {
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
        <h1 className="text-3xl font-bold mb-2">Terms and Conditions</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 12, 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Acceptance of Terms</h2>
            <p>By accessing or using PanoptesAI ("the Service"), operated by PanoptesAI ("we", "us", or "our"), you agree to be bound by these Terms and Conditions. If you do not agree to these terms, do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Description of Service</h2>
            <p>PanoptesAI is an AI-powered Reddit moderation platform that provides real-time scam and bot detection, content scoring, analytics, and moderation tools for Reddit communities. The Service includes a web dashboard, API, and Reddit (Devvit) app integration.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. User Accounts</h2>
            <p>To use certain features of the Service, you must create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must provide accurate and complete information when creating your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Reddit Integration</h2>
            <p>The Service integrates with Reddit through the Devvit platform. By using PanoptesAI, you authorize us to access and process content from subreddits you moderate, in accordance with Reddit's API Terms of Use and Developer Terms. You represent that you have the authority to install and use moderation tools on the subreddits you configure.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Use the Service for any unlawful purpose or in violation of Reddit's terms</li>
              <li>Attempt to gain unauthorized access to the Service or its systems</li>
              <li>Interfere with or disrupt the Service or servers connected to it</li>
              <li>Use the Service to harass, abuse, or harm other users or communities</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
              <li>Use automated means to access the Service except through our provided API</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Content and Data</h2>
            <p>The Service processes publicly available Reddit content for moderation purposes. We do not claim ownership of any Reddit content processed through the Service. Moderation decisions and configurations you create within the Service remain your responsibility.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. AI-Powered Scoring</h2>
            <p>PanoptesAI uses rule-based and AI-powered signals to generate risk scores for content. These scores are advisory tools to assist moderators and do not constitute definitive judgments. You are responsible for reviewing flagged content and making final moderation decisions.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Service Availability</h2>
            <p>We strive to maintain high availability but do not guarantee uninterrupted access to the Service. We may modify, suspend, or discontinue any aspect of the Service at any time without prior notice. We are not liable for any downtime or service interruptions.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, PanoptesAI and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service. Our total liability shall not exceed the amount you paid for the Service in the twelve months preceding the claim.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Indemnification</h2>
            <p>You agree to indemnify and hold harmless PanoptesAI and its operators from any claims, damages, losses, or expenses arising from your use of the Service, your violation of these terms, or your moderation decisions made using the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Changes to Terms</h2>
            <p>We reserve the right to modify these Terms at any time. We will notify users of material changes through the Service or via email. Your continued use of the Service after changes are posted constitutes your acceptance of the modified terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Termination</h2>
            <p>We may terminate or suspend your account at any time for violation of these Terms or for any other reason at our discretion. Upon termination, your right to use the Service ceases immediately.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">13. Governing Law</h2>
            <p>These Terms shall be governed by and construed in accordance with applicable law, without regard to conflict of law principles.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">14. Contact</h2>
            <p>If you have any questions about these Terms, please contact us at <a href="mailto:support@panoptesai.net" className="text-primary hover:underline">support@panoptesai.net</a>.</p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border px-4 md:px-6 py-4 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-4">
          <Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
          <span>&copy; {new Date().getFullYear()} PanoptesAI. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
