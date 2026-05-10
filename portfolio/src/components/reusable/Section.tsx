import React, { useEffect, useRef } from "react";

interface SectionProps {
  id?: string;
  className?: string;
  backgroundClass?: string;
  children: React.ReactNode;
  enableAnimation?: boolean;
}

const Section: React.FC<SectionProps> = ({
  id,
  className = "",
  backgroundClass = "bg-gray-50",
  children,
  enableAnimation = true
}) => {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enableAnimation) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const elements = entry.target.querySelectorAll(".fade-in-element");
            elements.forEach((el, index) => {
              setTimeout(() => {
                el.classList.add("animate-fade-in");
              }, index * 150);
            });
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );
    
    const currentRef = sectionRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }
    
    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [enableAnimation]);

  return (
    <section
      id={id}
      ref={sectionRef}
      className={`py-12 sm:py-16 md:py-20 ${backgroundClass} ${className}`}
    >
      <div className="section-container">
        {children}
      </div>
    </section>
  );
};

export default Section;
