const PrivacyPage = () => {
    return (<>
        <main className="max-w-3xl mx-auto py-12 px-4">
            <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
  
        <section className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-3">1. Anonymous Creation</h2>
            <p>
              Our platform is designed with creator privacy as a core principle. We never collect or store real names of our users.
              All creative works are published under pseudonyms or usernames of your choice.
            </p>
          </div>
  
          <div>
            <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>
            <p>We collect and store:</p>
            <ul className="list-disc ml-6 mt-2">
              <li>An anonymous username that is application-specific and cannot be traced back to you</li>
              <li>Optionally, an email address for account recovery and important updates</li>
              <li>Content you create and share on the platform</li>
              <li>Basic usage analytics (such as page views and feature usage)</li>
            </ul>
          </div>
  
          <div>
            <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
            <p>Your information is used to:</p>
            <ul className="list-disc ml-6 mt-2">
              <li>Maintain and secure your account</li>
              <li>Display your creative works</li>
              <li>Share essential service updates</li>
              <li>Improve platform functionality</li>
            </ul>
          </div>
  
          <div>
            <h2 className="text-xl font-semibold mb-3">4. Data Protection</h2>
            <p>
              We implement industry-standard security measures to protect your data.
              If you decide to share it with us, your email address is encrypted, and we never share your personal information with third parties
              without your explicit consent.
            </p>
          </div>
  
          <div>
            <h2 className="text-xl font-semibold mb-3">5. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc ml-6 mt-2">
              <li>Delete your account and associated data</li>
              <li>Export your creative works</li>
              <li>Update your account information</li>
              <li>Request information about your data</li>
            </ul>
          </div>
  
          <div>
            <h2 className="text-xl font-semibold mb-3">6. Updates to Privacy Policy</h2>
            <p>
              We may update this privacy policy as needed. Users will be notified of significant changes
              via their registered email address.
            </p>
          </div>
        </section>
      </main>
    </>)
  }
  
  export default PrivacyPage