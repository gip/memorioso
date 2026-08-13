const TermsPage = () => {
  return (<>
    <main className="max-w-3xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-8">Terms of Use</h1>

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing or using our platform, you agree to be bound by these Terms of Use. 
            If you do not agree to these terms, please do not use our services.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3">2. User Accounts</h2>
          <ul className="list-disc ml-6 mt-2">
            <li>You must be at least 18 years old to use this service</li>
            <li>You are responsible for maintaining the security of your account</li>
            <li>One person or entity may only maintain one account</li>
            <li>You may not share your account credentials with others</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3">3. Content Guidelines</h2>
          <p>You agree not to post content that:</p>
          <ul className="list-disc ml-6 mt-2">
            <li>Infringes on intellectual property rights</li>
            <li>Contains hate speech or harassment</li>
            <li>Promotes illegal activities</li>
            <li>Contains malware or malicious code</li>
            <li>Violates others&apos; privacy or personal rights</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3">4. Intellectual Property</h2>
          <p>
            You retain ownership of content you create and post. By posting content, you grant us a 
            non-exclusive, worldwide license to use, display, and distribute your content on our platform.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3">5. Platform Rules</h2>
          <ul className="list-disc ml-6 mt-2">
            <li>Do not attempt to manipulate platform metrics</li>
            <li>Do not use automated tools without explicit permission</li>
            <li>Do not impersonate others or create misleading accounts</li>
            <li>Respect other users and their creative works</li>
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3">6. Termination</h2>
          <p>
            We reserve the right to suspend or terminate accounts that violate these terms, 
            engage in illegal activities, or harm our community. Users may also delete their 
            own accounts at any time.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3">7. Disclaimers</h2>
          <p>
            Our platform is provided &quot;as is&quot; without warranties of any kind. We are not 
            responsible for user-generated content or any damages resulting from platform use.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-3">8. Changes to Terms</h2>
          <p>
            We may modify these terms at any time. Continued use of the platform after changes 
            constitutes acceptance of the new terms. Major changes will be announced to users through
            a notice on the homepage.
          </p>
        </div>
      </section>
    </main>
  </>)
}

export default TermsPage 