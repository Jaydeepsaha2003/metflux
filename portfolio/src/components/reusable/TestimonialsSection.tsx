import React, { useEffect, useState, useRef } from "react";
import Section from "./Section";
import SectionHeader from "./SectionHeader";
import TestimonialCard from "./TestimonialCard";

interface TestimonialItem {
  quote: string;
  author: string;
  role: string;
  company: string;
  avatar?: string;
}

interface TestimonialsData {
  badge?: {
    icon?: string;
    text: string;
  };
  title: string;
  subtitle?: string;
  description?: string;
  items: TestimonialItem[];
}

interface TestimonialsSectionProps {
  data: TestimonialsData;
  backgroundClass?: string;
  className?: string;
  id?: string;
}

const TestimonialsSection: React.FC<TestimonialsSectionProps> = ({
  data,
  backgroundClass = "bg-white",
  className = "",
  id
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get number of visible cards based on screen size
  const getVisibleCards = () => {
    if (typeof window !== 'undefined') {
      if (window.innerWidth < 768) return 1;
      if (window.innerWidth < 1024) return 2;
      return 3;
    }
    return 3;
  };

  const [visibleCards, setVisibleCards] = useState(getVisibleCards());

  useEffect(() => {
    const handleResize = () => {
      setVisibleCards(getVisibleCards());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-slide functionality
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isAnimating) {
        setIsAnimating(true);
        setCurrentIndex((prevIndex) => {
          const nextIndex = (prevIndex + 1) % Math.ceil(data.items.length / visibleCards);
          return nextIndex;
        });
        setTimeout(() => setIsAnimating(false), 500);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [isAnimating, data.items.length, visibleCards]);

  const totalSlides = Math.ceil(data.items.length / visibleCards);

  return (
    <Section
      id={id}
      backgroundClass={backgroundClass}
      className={className}
    >
      <SectionHeader
        badge={data.badge}
        title={data.title}
        subtitle={data.subtitle}
        description={data.description}
      />
      
      {/* Testimonials Slider */}
      <div className="relative overflow-hidden" ref={containerRef}>
        <div 
          className="flex transition-transform duration-500 ease-in-out"
          style={{
            transform: `translateX(-${currentIndex * (100 / totalSlides)}%)`,
            width: `${totalSlides * 100}%`
          }}
        >
          {Array.from({ length: totalSlides }).map((_, slideIndex) => (
            <div key={slideIndex} className="flex gap-6" style={{ width: `${100 / totalSlides}%` }}>
              {data.items
                .slice(slideIndex * visibleCards, (slideIndex + 1) * visibleCards)
                .map((testimonial, cardIndex) => (
                  <div key={slideIndex * visibleCards + cardIndex} className="flex-1">
                    <TestimonialCard
                      quote={testimonial.quote}
                      author={testimonial.author}
                      role={testimonial.role}
                      company={testimonial.company}
                      avatar={testimonial.avatar}
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
      
      {/* Pagination Dots */}
      <div className="flex justify-center mt-8 space-x-2">
        {Array.from({ length: totalSlides }).map((_, index) => (
          <button
            key={index}
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              index === currentIndex ? 'bg-pulse-500 scale-110' : 'bg-gray-300 hover:bg-gray-400'
            }`}
            onClick={() => {
              if (!isAnimating) {
                setIsAnimating(true);
                setCurrentIndex(index);
                setTimeout(() => setIsAnimating(false), 500);
              }
            }}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </Section>
  );
};

export default TestimonialsSection;
