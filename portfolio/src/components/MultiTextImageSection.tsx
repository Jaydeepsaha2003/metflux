import React, { useEffect, useRef, useState } from "react";

const MultiTextImageSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const ticking = useRef(false);

  const sectionsData = [
    {
      id: 1,
      badge: "07",
      category: "Manufacturing",
      title: "Smart Factory Automation",
      description: "Transform your manufacturing processes with intelligent robotic systems that adapt to changing production demands and optimize efficiency in real-time.",
      features: [
        {
          title: "Predictive Maintenance",
          description: "AI algorithms predict equipment failures before they occur, reducing downtime by up to 70%."
        },
        {
          title: "Quality Assurance",
          description: "Computer vision systems ensure 99.9% accuracy in product quality control."
        },
        {
          title: "Flexible Production",
          description: "Easily reconfigure production lines for different products without manual intervention."
        }
      ],
      image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
      stats: { value: "70%", label: "Efficiency Boost" }
    },
    {
      id: 2,
      badge: "08",
      category: "Logistics",
      title: "Autonomous Warehouse Systems",
      description: "Revolutionize your supply chain with fully autonomous warehouse robots that handle inventory management, order fulfillment, and logistics optimization.",
      features: [
        {
          title: "24/7 Operations",
          description: "Continuous operation capabilities with automatic charging and maintenance scheduling."
        },
        {
          title: "Real-time Tracking",
          description: "Complete visibility of inventory levels and order status across all warehouse locations."
        },
        {
          title: "Scalable Solutions",
          description: "Easily scale up or down based on seasonal demands and business growth."
        }
      ],
      image: "https://images.unsplash.com/photo-1586953208448-b95a79798f07?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
      stats: { value: "95%", label: "Order Accuracy" }
    },
    {
      id: 3,
      badge: "09",
      category: "Healthcare",
      title: "Medical Assistant Robots",
      description: "Enhance patient care with precision medical robots that assist healthcare professionals in surgeries, diagnostics, and patient monitoring with unmatched accuracy.",
      features: [
        {
          title: "Surgical Precision",
          description: "Sub-millimeter accuracy in robotic-assisted surgeries with enhanced visualization."
        },
        {
          title: "Patient Monitoring",
          description: "Continuous vital sign monitoring and alert systems for critical care situations."
        },
        {
          title: "Sterile Operations",
          description: "Maintain sterile environments with contactless interactions and UV sterilization."
        }
      ],
      image: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80",
      stats: { value: "99.8%", label: "Success Rate" }
    }
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        setIsIntersecting(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          if (!sectionRef.current) return;
          
          const sectionRect = sectionRef.current.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const totalScrollDistance = viewportHeight * 2;
          
          let progress = 0;
          if (sectionRect.top <= 0) {
            progress = Math.min(1, Math.max(0, Math.abs(sectionRect.top) / totalScrollDistance));
          }
          
          if (progress >= 0.66) {
            setActiveCardIndex(2);
          } else if (progress >= 0.33) {
            setActiveCardIndex(1);
          } else {
            setActiveCardIndex(0);
          }
          
          ticking.current = false;
        });
        
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, []);

  const isFirstVisible = isIntersecting && activeCardIndex === 0;
  const isSecondVisible = activeCardIndex === 1;
  const isThirdVisible = activeCardIndex === 2;

  const renderSection = (data, index, isVisible, zIndex, transform, opacity) => (
    <div 
      className={`absolute inset-0 ${isVisible ? 'animate-card-enter' : ''}`}
      style={{
        zIndex,
        transform,
        opacity,
        transition: 'transform 0.8s ease-in-out, opacity 0.8s ease-in-out',
        pointerEvents: isVisible ? 'auto' : 'none'
      }}
    >
      <div className="container px-6 lg:px-8 mx-auto h-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center h-full">
          {/* Image - Left Side */}
          <div className="relative">
            <div className="relative rounded-2xl overflow-hidden shadow-2xl">
              <img
                src={data.image}
                alt={data.title}
                className={`w-full h-auto object-cover transition-all duration-1000 ease-out transform ${
                  isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-60'
                }`}
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent"></div>
              
              {/* Floating stats card */}
              <div className={`absolute bottom-6 right-6 bg-white rounded-xl p-4 shadow-lg transition-all duration-1000 ease-out transform ${
                isVisible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
              }`}>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-pulse-500 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{data.stats.value}</div>
                    <div className="text-sm text-gray-600">{data.stats.label}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="absolute -top-4 -left-4 w-24 h-24 bg-pulse-500 rounded-full opacity-20 blur-xl"></div>
            <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-pulse-300 rounded-full opacity-10 blur-2xl"></div>
          </div>

          {/* Text Content - Right Side */}
          <div className="space-y-8">
            {/* Badge Animation */}
            <div className="space-y-6">
              <div className={`pulse-chip transition-all duration-800 ease-out transform ${
                isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`}>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">{data.badge}</span>
                <span>{data.category}</span>
              </div>
              
              <h2 className={`section-title text-3xl sm:text-4xl md:text-5xl font-display font-bold text-gray-900 transition-all duration-1000 ease-out transform ${
                isVisible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
              }`} style={{ transitionDelay: isVisible ? '0.2s' : '0s' }}>
                {data.title}
              </h2>
              
              <p className={`text-lg text-gray-600 leading-relaxed transition-all duration-1000 ease-out transform ${
                isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
              }`} style={{ transitionDelay: isVisible ? '0.4s' : '0s' }}>
                {data.description}
              </p>
            </div>

            {/* Features List */}
            <div className="space-y-4">
              {data.features.map((feature, featureIndex) => (
                <div 
                  key={featureIndex} 
                  className={`flex items-start gap-4 transition-all duration-800 ease-out transform ${
                    isVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
                  }`}
                  style={{ transitionDelay: isVisible ? `${0.6 + featureIndex * 0.1}s` : '0s' }}
                >
                  <div className="flex-shrink-0 w-6 h-6 bg-pulse-500 rounded-full flex items-center justify-center mt-1">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">{feature.title}</h3>
                    <p className="text-gray-600 text-sm">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA Buttons */}
            <div className={`flex flex-col sm:flex-row gap-4 transition-all duration-1000 ease-out transform ${
              isVisible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
            }`} style={{ transitionDelay: isVisible ? '0.9s' : '0s' }}>
              <button className="button-primary">
                Learn More
              </button>
              <button className="button-secondary">
                View Case Studies
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div 
      ref={sectionRef} 
      className="relative" 
      style={{ height: '300vh' }}
    >
      <section className="w-full h-screen py-10 md:py-16 sticky top-0 overflow-hidden bg-white">
        <div className="relative h-full">
          {/* First Section */}
          {renderSection(
            sectionsData[0], 
            0, 
            isFirstVisible, 
            10, 
            `translateY(${isFirstVisible ? '0px' : '-100px'}) scale(1)`, 
            isFirstVisible ? 1 : 0
          )}
          
          {/* Second Section */}
          {renderSection(
            sectionsData[1], 
            1, 
            isSecondVisible, 
            20, 
            `translateY(${isSecondVisible ? '0px' : activeCardIndex < 1 ? '100px' : '-100px'}) scale(1)`, 
            isSecondVisible ? 1 : 0
          )}
          
          {/* Third Section */}
          {renderSection(
            sectionsData[2], 
            2, 
            isThirdVisible, 
            30, 
            `translateY(${isThirdVisible ? '0px' : '100px'}) scale(1)`, 
            isThirdVisible ? 1 : 0
          )}
        </div>
      </section>
    </div>
  );
};

export default MultiTextImageSection;
