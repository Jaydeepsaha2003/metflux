import React, { useState, useEffect } from "react";
import LoadingScreen from "./LoadingScreen";

interface PageWrapperProps {
  children: React.ReactNode;
  loadingDuration?: number;
}

const PageWrapper: React.FC<PageWrapperProps> = ({ 
  children, 
  loadingDuration = 2000 
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [showContent, setShowContent] = useState(false);

  const handleLoadingComplete = () => {
    setIsLoading(false);
    // Small delay to ensure smooth transition
    setTimeout(() => {
      setShowContent(true);
    }, 100);
  };

  return (
    <>
      {isLoading && (
        <LoadingScreen 
          onLoadingComplete={handleLoadingComplete}
          duration={loadingDuration}
        />
      )}
      
      {showContent && (
        <div className="animate-fade-in">
          {children}
        </div>
      )}
    </>
  );
};

export default PageWrapper;
