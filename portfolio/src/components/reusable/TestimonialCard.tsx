import React from "react";
import Image from "next/image";

interface TestimonialCardProps {
  quote: string;
  author: string;
  role: string;
  company: string;
  avatar?: string;
  className?: string;
}

const TestimonialCard: React.FC<TestimonialCardProps> = ({
  quote,
  author,
  role,
  company,
  avatar,
  className = ""
}) => {
  return (
    <div className={`bg-white rounded-2xl p-6 sm:p-8 shadow-elegant hover:shadow-elegant-hover transition-all duration-300 ${className}`}>
      <div className="mb-6">
        <div className="text-pulse-500 text-4xl mb-4">"</div>
        <p className="text-gray-700 leading-relaxed text-lg">
          {quote}
        </p>
      </div>
      
      <div className="flex items-center space-x-4">
        {avatar && (
          <div className="relative w-12 h-12 rounded-full overflow-hidden bg-gray-200">
            <Image
              src={avatar}
              alt={author}
              width={48}
              height={48}
              className="w-full h-full object-cover"
              onError={() => {
                console.warn(`Failed to load avatar: ${avatar}`);
              }}
            />
          </div>
        )}
        <div>
          <div className="font-semibold text-gray-900">{author}</div>
          <div className="text-sm text-gray-600">
            {role} at {company}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestimonialCard;
