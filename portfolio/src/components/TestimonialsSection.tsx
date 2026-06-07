import React from "react";
import siteData from "@/data/siteData";

const TestimonialsSection = () => {
  const name = siteData.site.name;

  const testimonials = [
    {
      id: 1,
      text: `The CRGO laminations from ${name} have significantly improved our transformer efficiency. The quality is exceptional and their technical support is outstanding. Delivery was on time and packaging was perfect.`,
      name: "Rajesh Kumar",
      position: "Chief Engineer, Power Grid Corp"
    },
    {
      id: 2,
      text: `Working with ${name} for our amorphous cores has been a game-changer. Their energy-efficient solutions have reduced our transformer losses by 40%. Highly recommended for power equipment manufacturers.`,
      name: "Priya Sharma",
      position: "Technical Director, Electrical Industries Ltd"
    },
    {
      id: 3,
      text: `Outstanding quality and precision in their wound cores. ${name} has become our trusted partner for all transformer core requirements. Their ISO certification and BIS approval gives us confidence.`,
      name: "Amit Patel",
      position: "Operations Manager, TransPower Solutions"
    },
    {
      id: 4,
      text: `${name} delivered excellent custom engineering solutions for our specialized transformer requirements. Their team understood our needs perfectly and delivered beyond expectations. Great value for investment.`,
      name: "Sunita Reddy",
      position: "Project Manager, Infrastructure Development"
    },
    {
      id: 5,
      text: "Impressive manufacturing facility and quality control processes. Their slit coils meet all international standards. The sustainability practices and environmental compliance are commendable.",
      name: "Vikram Singh",
      position: "Quality Head, Steel Processing Industries"
    },
    {
      id: 6,
      text: `${name}'s EPC services are top-notch. From design to commissioning, they handled our complete transformer manufacturing setup professionally. Their expertise in the field is evident in every aspect.`,
      name: "Meera Gupta",
      position: "VP Engineering, Power Equipment Manufacturing"
    }
  ];

  return (
    <section className="w-full py-16 md:py-24 bg-gray-50" id="testimonials">
      <div className="container px-6 lg:px-8 mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="section-title text-3xl sm:text-4xl md:text-5xl font-display font-bold mb-6 text-gray-900">
            What Our Clients Say
          </h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Hear from industry leaders who trust {name} for their transformer core and electrical equipment needs
          </p>
        </div>

        {/* Testimonials Marquee with Blur Effects */}
        <div className="relative">
          {/* First Row - Right to Left */}
          <div className="relative overflow-hidden mb-8">
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-gray-50 to-transparent z-10 pointer-events-none"></div>
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-gray-50 to-transparent z-10 pointer-events-none"></div>
            <div className="flex animate-marquee-rtl">
              {testimonials.concat(testimonials).map((testimonial, index) => (
                <div key={`rtl-${testimonial.id}-${index}`} className="flex-shrink-0 mx-2 w-72 sm:w-80 md:w-96">
                  <div className="bg-white rounded-xl p-6 h-full">
                    <blockquote className="text-gray-700 leading-relaxed mb-6 text-sm line-clamp-4">
                      &ldquo;{testimonial.text}&rdquo;
                    </blockquote>
                    <div className="text-left">
                      <div className="font-bold text-gray-900 text-sm">{testimonial.name}</div>
                      <div className="text-gray-600 text-xs">{testimonial.position}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Second Row - Left to Right */}
          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-gray-50 to-transparent z-10 pointer-events-none"></div>
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-gray-50 to-transparent z-10 pointer-events-none"></div>
            <div className="flex animate-marquee-ltr">
              {testimonials.concat(testimonials).map((testimonial, index) => (
                <div key={`ltr-${testimonial.id}-${index}`} className="flex-shrink-0 mx-2 w-72 sm:w-80 md:w-96">
                  <div className="bg-white rounded-xl p-6 h-full">
                    <blockquote className="text-gray-700 leading-relaxed mb-6 text-sm line-clamp-4">
                      &ldquo;{testimonial.text}&rdquo;
                    </blockquote>
                    <div className="text-left">
                      <div className="font-bold text-gray-900 text-sm">{testimonial.name}</div>
                      <div className="text-gray-600 text-xs">{testimonial.position}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
