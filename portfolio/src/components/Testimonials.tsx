
import React, { useRef, useEffect, useState } from "react";

interface TestimonialProps {
  content: string;
  author: string;
  role: string;
  company?: string;
  avatar?: string;
  rating: number;
}

const testimonials: TestimonialProps[] = [
  {
    content: "Atlas has revolutionized our manufacturing process. The precision and adaptability are unmatched. Our production efficiency increased by 45% in just two months.",
    author: "Sarah Chen",
    role: "Chief Operations Officer",
    company: "TechFlow Industries",
    avatar: "/avatar1.jpg",
    rating: 5
  },
  {
    content: "Working with Atlas feels like having a highly skilled colleague who never gets tired. The learning capabilities and safety features give us complete confidence.",
    author: "Michael Rodriguez",
    role: "Head of Robotics",
    company: "AutoVance Corp",
    avatar: "/avatar2.jpg",
    rating: 5
  },
  {
    content: "The integration was seamless, and Atlas adapted to our workflow faster than we expected. It's not just a robot; it's a game-changer for our entire operation.",
    author: "Dr. Emily Watson",
    role: "Research Director",
    company: "Innovation Labs",
    avatar: "/avatar3.jpg",
    rating: 5
  },
  {
    content: "Atlas has transformed how we approach complex tasks. The human-like intuition combined with robotic precision is exactly what our industry needed.",
    author: "David Park",
    role: "VP of Engineering",
    company: "NextGen Solutions",
    avatar: "/avatar4.jpg",
    rating: 5
  },
  {
    content: "The ROI from Atlas exceeded our projections. Beyond the cost savings, the quality improvements and reduced workplace incidents have been remarkable.",
    author: "Lisa Thompson",
    role: "Plant Manager",
    company: "Advanced Manufacturing",
    avatar: "/avatar5.jpg",
    rating: 5
  },
  {
    content: "Atlas doesn't just follow commands; it anticipates needs and suggests improvements. It's like having an AI partner that truly understands our goals.",
    author: "James Wilson",
    role: "CTO",
    company: "Smart Automation",
    avatar: "/avatar6.jpg",
    rating: 5
  }
];

const TestimonialCard = ({ content, author, role, company, avatar, rating }: TestimonialProps) => {
  return (
    <div className="glass-card p-6 sm:p-8 h-full flex flex-col justify-between min-h-[300px] transform transition-all duration-300 hover:scale-[1.02] hover:shadow-elegant-hover">
      {/* Rating Stars */}
      <div className="flex mb-4">
        {[...Array(rating)].map((_, i) => (
          <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
            <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/>
          </svg>
        ))}
      </div>
      
      {/* Content */}
      <blockquote className="text-gray-700 text-base sm:text-lg leading-relaxed mb-6 flex-grow italic">
        "{content}"
      </blockquote>
      
      {/* Author Info */}
      <div className="flex items-center mt-auto">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pulse-400 to-pulse-600 flex items-center justify-center text-white font-semibold mr-4">
          {author.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <h4 className="font-semibold text-gray-900 text-sm sm:text-base">{author}</h4>
          <p className="text-gray-600 text-xs sm:text-sm">{role}</p>
          {company && <p className="text-pulse-500 text-xs sm:text-sm font-medium">{company}</p>}
        </div>
      </div>
    </div>
  );
};

const Testimonials = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Auto-slide functionality
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isAnimating) {
        setIsAnimating(true);
        setCurrentIndex((prevIndex) => {
          const nextIndex = (prevIndex + 1) % Math.ceil(testimonials.length / getVisibleCards());
          return nextIndex;
        });
        setTimeout(() => setIsAnimating(false), 500);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [isAnimating]);

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

  const totalSlides = Math.ceil(testimonials.length / visibleCards);

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

  return (
    <section className="py-12 sm:py-16 md:py-20 bg-white relative" id="testimonials" ref={sectionRef}>
      <div className="section-container">
        <div className="text-center mb-10 sm:mb-16">
          <div className="pulse-chip mx-auto mb-3 sm:mb-4 opacity-0 fade-in-element">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-pulse-500 text-white mr-2">★</span>
            <span>Testimonials</span>
          </div>
          <h2 className="section-title mb-3 sm:mb-4 opacity-0 fade-in-element">
            What Our Clients <br className="hidden sm:block" />Say About Atlas
          </h2>
          <p className="section-subtitle mx-auto opacity-0 fade-in-element">
            Real experiences from companies and individuals who have transformed their operations with Atlas.
          </p>
        </div>
        
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
                {testimonials
                  .slice(slideIndex * visibleCards, (slideIndex + 1) * visibleCards)
                  .map((testimonial, cardIndex) => (
                    <div key={slideIndex * visibleCards + cardIndex} className="flex-1">
                      <TestimonialCard {...testimonial} />
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
      </div>
    </section>
  );
};

export default Testimonials;
