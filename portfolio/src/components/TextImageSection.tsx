import React from "react";

const TextImageSection = () => {
  return (
    <section className="w-full py-16 md:py-24 bg-gray-50">
      <div className="container px-6 lg:px-8 mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text Content - Left Side */}
          <div className="space-y-8">
            <div className="space-y-6">
              <div className="pulse-chip opacity-0 animate-fade-in" style={{
                animationDelay: "0.1s"
              }}>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">06</span>
                <span>Innovation</span>
              </div>
              
              <h2 className="section-title text-3xl sm:text-4xl md:text-5xl font-display font-bold text-gray-900 opacity-0 animate-fade-in" style={{
                animationDelay: "0.2s"
              }}>
                Advanced Robotics Technology
              </h2>
              
              <p className="text-lg text-gray-600 leading-relaxed opacity-0 animate-fade-in" style={{
                animationDelay: "0.3s"
              }}>
                Our cutting-edge robotic systems combine artificial intelligence, precision engineering, 
                and innovative design to deliver unparalleled performance in industrial applications. 
                Experience the future of automation with our state-of-the-art solutions.
              </p>
            </div>

            {/* Features List */}
            <div className="space-y-4 opacity-0 animate-fade-in" style={{
              animationDelay: "0.4s"
            }}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-6 h-6 bg-pulse-500 rounded-full flex items-center justify-center mt-1">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">AI-Powered Intelligence</h3>
                  <p className="text-gray-600 text-sm">Machine learning algorithms that adapt and improve performance over time.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-6 h-6 bg-pulse-500 rounded-full flex items-center justify-center mt-1">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Precision Engineering</h3>
                  <p className="text-gray-600 text-sm">Sub-millimeter accuracy for the most demanding industrial applications.</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-6 h-6 bg-pulse-500 rounded-full flex items-center justify-center mt-1">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Seamless Integration</h3>
                  <p className="text-gray-600 text-sm">Easy integration with existing systems and workflows.</p>
                </div>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 opacity-0 animate-fade-in" style={{
              animationDelay: "0.5s"
            }}>
              <button className="button-primary">
                Learn More
              </button>
              <button className="button-secondary">
                View Specifications
              </button>
            </div>
          </div>

          {/* Image - Right Side */}
          <div className="relative opacity-0 animate-fade-in" style={{
            animationDelay: "0.6s"
          }}>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl">
              <img
                src="https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                alt="Advanced Robotics Technology"
                className="w-full h-auto object-cover"
              />
              {/* Gradient overlay for better text contrast if needed */}
              <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent"></div>
              
              {/* Floating stats card */}
              <div className="absolute bottom-6 left-6 bg-white rounded-xl p-4 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-pulse-500 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">99.9%</div>
                    <div className="text-sm text-gray-600">Accuracy Rate</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-pulse-500 rounded-full opacity-20 blur-xl"></div>
            <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-pulse-300 rounded-full opacity-10 blur-2xl"></div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TextImageSection;
