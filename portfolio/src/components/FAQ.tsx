import siteData from "@/data/siteData";
import React, { useEffect, useRef } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const elements = entry.target.querySelectorAll(".fade-in-element");
            elements.forEach((el, index) => {
              setTimeout(() => {
                el.classList.add("animate-fade-in");
              }, index * 100);
            });
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    return () => {
      if (sectionRef.current) {
        observer.unobserve(sectionRef.current);
      }
    };
  }, []);

  const faqData = [
    {
      id: "item-1",
      question: `What types of transformers does ${siteData.site.name} manufacture?`,
      answer: `${siteData.site.name} specializes in a wide range of transformers including distribution transformers, power transformers, dry-type transformers, oil-filled transformers, and custom-designed specialty transformers. We serve voltage ratings from 1kV to 220kV for various industrial and commercial applications.`
    },
    {
      id: "item-2",
      question: "How do I determine the right transformer size for my application?",
      answer: "Selecting the correct transformer size depends on your load requirements, voltage specifications, and environmental conditions. Our engineering team provides free consultation to analyze your power needs and recommend the optimal transformer configuration for maximum efficiency and reliability."
    },
    {
      id: "item-3",
      question: "What quality standards do your transformers meet?",
      answer: `All ${siteData.site.name} transformers are manufactured to meet or exceed IEC, IEEE, and ANSI standards. We maintain ISO 9001:2015 quality certification and conduct rigorous testing including impulse, partial discharge, and temperature rise tests to ensure superior performance and longevity.`
    },
    {
      id: "item-4",
      question: "Do you provide installation and commissioning services?",
      answer: `Yes, ${siteData.site.name} offers complete turnkey solutions including professional installation, commissioning, and startup services. Our certified technicians ensure proper installation according to safety standards and provide comprehensive testing and documentation upon completion.`
    },
    {
      id: "item-5",
      question: "What is the typical lead time for transformer delivery?",
      answer: "Lead times vary depending on transformer specifications and current production schedule. Standard distribution transformers typically ship within 4-6 weeks, while custom-designed power transformers may require 8-16 weeks. We provide detailed delivery schedules during the quotation process."
    },
    {
      id: "item-6",
      question: "Do you offer maintenance and repair services?",
      answer: `Absolutely. ${siteData.site.name} provides comprehensive maintenance programs including routine inspections, oil analysis, condition monitoring, and emergency repair services. Our maintenance contracts help extend transformer life and prevent costly unplanned outages through proactive care.`
    },
    {
      id: "item-7",
      question: "Can you design custom transformers for specific applications?",
      answer: "Yes, our experienced engineering team specializes in custom transformer design for unique applications. Whether you need special voltage ratios, unusual configurations, or specific environmental requirements, we can develop tailored solutions to meet your exact specifications."
    },
    {
      id: "item-8",
      question: "What warranty coverage do you provide on transformers?",
      answer: `${siteData.site.name} provides comprehensive warranty coverage including 2 years on materials and workmanship for standard transformers, with extended warranty options available. We stand behind our products with responsive technical support and rapid replacement services when needed.`
    }
  ];

  return (
    <section className="py-12 sm:py-16 md:py-20 bg-gray-50" id="faq" ref={sectionRef}>
      <div className="section-container">
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="section-title mb-3 sm:mb-4 opacity-0 fade-in-element">
            Frequently Asked <br className="hidden sm:block" />Questions
          </h2>
          <p className="section-subtitle mx-auto opacity-0 fade-in-element">
            Everything you need to know about our electrical solutions and how we can power your projects.
          </p>
        </div>
        
        <div className="max-w-4xl mx-auto">
          <Accordion type="single" collapsible className="w-full space-y-4">
            {faqData.map((faq, index) => (
              <AccordionItem 
                key={faq.id} 
                value={faq.id} 
                className={`glass-card opacity-0 fade-in-element border-0 shadow-elegant hover:shadow-elegant-hover transition-all duration-300`}
                style={{ animationDelay: `${0.1 * (index + 3)}s` }}
              >
                <AccordionTrigger className="text-left hover:no-underline px-6 py-4 text-base sm:text-lg font-medium hover:text-pulse-500 transition-colors duration-200">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-4 text-gray-600 text-sm sm:text-base leading-relaxed">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FAQ;
