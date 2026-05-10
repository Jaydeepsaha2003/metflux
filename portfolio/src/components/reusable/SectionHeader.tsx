import React from "react";
import Badge from "./Badge";

interface SectionHeaderProps {
  badge?: {
    icon?: string;
    text: string;
  };
  title: string;
  subtitle?: string;
  description?: string;
  className?: string;
  centered?: boolean;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  badge,
  title,
  subtitle,
  description,
  className = "",
  centered = true
}) => {
  return (
    <div className={`mb-10 sm:mb-16 ${centered ? 'text-center' : ''} ${className}`}>
      {badge && (
        <div className="opacity-0 fade-in-element">
          <Badge icon={badge.icon} text={badge.text} />
        </div>
      )}
      
      <h2 className={`section-title mb-3 sm:mb-4 opacity-0 fade-in-element ${centered ? 'mx-auto' : ''}`}>
        {subtitle && (
          <>
            {title}
            <br className="hidden sm:block" />
            {subtitle}
          </>
        )}
        {!subtitle && title}
      </h2>
      
      {description && (
        <p className={`section-subtitle opacity-0 fade-in-element ${centered ? 'mx-auto' : ''}`}>
          {description}
        </p>
      )}
    </div>
  );
};

export default SectionHeader;
