import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { KeyPair, EncryptedData, SigningKeyPair, Certificate } from '../types';
import { CertificateManager } from '../utils/certificates';
import { DigitalSigner } from '../utils/signing';
import { ForwardSecrecy } from '../utils/forwardSecrecy';
import { secureWipe } from '../utils/encoding';

interface CryptoContextType {
  keyPair: KeyPair | null;
  signingKeyPair: SigningKeyPair | null;
  certificate: Certificate | null;
  sharedSecret: CryptoKey | null;
  isInitializing: boolean;
  generateKeyPair: () => Promise<KeyPair>;
  generateSigningKeyPair: () => Promise<SigningKeyPair>;
  generateCertificate: (subject: string) => Promise<Certificate>;
  generatePairingCode: () => Promise<string>;
  encryptMessage: (message: string) => Promise<EncryptedData>;
  decryptMessage: (encryptedData: EncryptedData, messageIndex?: number) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
  verifyMessage: (message: string, signature: string, senderCert: Certificate) => Promise<boolean>;
  exportPublicKey: (key: CryptoKey) => Promise<string>;
  importPublicKey: (keyData: string) => Promise<CryptoKey>;
  verifyCertificate: (cert: Certificate) => Promise<boolean>;
  reset: () => void;
}

const CryptoContext = createContext<CryptoContextType | null>(null);

export const useCrypto = () => {
  const context = useContext(CryptoContext);
  if (!context) {
    throw new Error('useCrypto must be used within a CryptoProvider');
  }
  return context;
};

export const CryptoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [signingKeyPair, setSigningKeyPair] = useState<SigningKeyPair | null>(null);
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [sharedSecret, setSharedSecret] = useState<CryptoKey | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [certificateManager] = useState(() => CertificateManager.getInstance());

  // Initialize crypto on mount - but don't generate certificate until username is set
  useEffect(() => {
    const initializeCrypto = async () => {
      try {
        setIsInitializing(true);
        
        // Only generate signing key pair initially
        await generateSigningKeyPair();
        
        // Check if we have a saved username and generate certificate
        const savedUsername = localStorage.getItem('cipher-username');
        if (savedUsername) {
          await generateCertificate(savedUsername);
        }
        
      } catch (error) {
        console.error('Failed to initialize crypto:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeCrypto();
  }, []);

  // Cleanup on unmount or page unload
  useEffect(() => {
    const cleanup = () => {
      secureWipe(keyPair);
      secureWipe(signingKeyPair);
      secureWipe(certificate);
      certificateManager.reset();
    };

    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('unload', cleanup);

    return () => {
      cleanup();
      window.removeEventListener('beforeunload', cleanup);
      window.removeEventListener('unload', cleanup);
    };
  }, [keyPair, signingKeyPair, certificate, certificateManager]);

  // Generate ECDH key pair for encryption
  const generateKeyPair = async (): Promise<KeyPair> => {
    try {
      const newKeyPair = await window.crypto.subtle.generateKey(
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        false,
        ['deriveKey']
      );

      const pair = {
        publicKey: newKeyPair.publicKey,
        privateKey: newKeyPair.privateKey
      };

      setKeyPair(pair);
      return pair;
    } catch (error) {
      console.error('Failed to generate key pair:', error);
      throw new Error('Key pair generation failed');
    }
  };

  // Generate ECDSA key pair for signing
  const generateSigningKeyPair = async (): Promise<SigningKeyPair> => {
    try {
      const newKeyPair = await certificateManager.generateSigningKeyPair();
      setSigningKeyPair(newKeyPair);
      return newKeyPair;
    } catch (error) {
      console.error('Failed to generate signing key pair:', error);
      throw new Error('Signing key pair generation failed');
    }
  };

  // Generate certificate for user
  const generateCertificate = async (subject: string): Promise<Certificate> => {
    if (!signingKeyPair) {
      // If signing key pair doesn't exist, generate it first
      await generateSigningKeyPair();
    }

    if (!signingKeyPair) {
      throw new Error('Signing key pair not available');
    }

    try {
      // Add timestamp to make username unique in case of duplicates
      const uniqueSubject = `${subject}-${Date.now().toString(36)}`;
      
      const cert = await certificateManager.issueCertificate(
        uniqueSubject,
        signingKeyPair.publicKey
      );
      setCertificate(cert);
      return cert;
    } catch (error) {
      console.error('Failed to generate certificate:', error);
      throw new Error('Certificate generation failed');
    }
  };

  // Generate a secure random pairing code
  const generatePairingCode = async (): Promise<string> => {
    try {
      const array = new Uint8Array(4);
      window.crypto.getRandomValues(array);
      const code = Array.from(array)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
        .slice(0, 6);
      return code;
    } catch (error) {
      console.error('Failed to generate pairing code:', error);
      throw new Error('Pairing code generation failed');
    }
  };

  // Encrypt a message using forward secrecy
  const encryptMessage = async (message: string): Promise<EncryptedData> => {
    if (!sharedSecret) {
      throw new Error('No shared secret established');
    }

    try {
      return await ForwardSecrecy.encryptWithForwardSecrecy(message, sharedSecret);
    } catch (error) {
      console.error('Failed to encrypt message:', error);
      throw new Error('Message encryption failed');
    }
  };

  // Decrypt a message using forward secrecy
  const decryptMessage = async (
    encryptedData: EncryptedData,
    messageIndex: number = 0
  ): Promise<string> => {
    if (!sharedSecret) {
      throw new Error('No shared secret established');
    }

    try {
      return await ForwardSecrecy.decryptWithForwardSecrecy(
        encryptedData,
        sharedSecret,
        messageIndex
      );
    } catch (error) {
      console.error('Failed to decrypt message:', error);
      throw new Error('Message decryption failed');
    }
  };

  // Sign a message
  const signMessage = async (message: string): Promise<string> => {
    if (!signingKeyPair) {
      throw new Error('Signing key pair not generated');
    }

    try {
      return await DigitalSigner.signData(message, signingKeyPair.privateKey);
    } catch (error) {
      console.error('Failed to sign message:', error);
      throw new Error('Message signing failed');
    }
  };

  // Verify a message signature
  const verifyMessage = async (
    message: string,
    signature: string,
    senderCert: Certificate
  ): Promise<boolean> => {
    try {
      // First verify the certificate
      const isCertValid = await certificateManager.verifyCertificate(senderCert);
      if (!isCertValid) {
        console.warn('Invalid certificate for message verification');
        return false;
      }

      // Then verify the message signature
      const senderPublicKey = await certificateManager.importPublicKey(senderCert.publicKey);
      return await DigitalSigner.verifySignature(message, signature, senderPublicKey);
    } catch (error) {
      console.error('Message verification failed:', error);
      return false;
    }
  };

  // Export public key as base64
  const exportPublicKey = async (key: CryptoKey): Promise<string> => {
    try {
      const exported = await window.crypto.subtle.exportKey('raw', key);
      return btoa(String.fromCharCode(...new Uint8Array(exported)));
    } catch (error) {
      console.error('Failed to export public key:', error);
      throw new Error('Public key export failed');
    }
  };

  // Import public key from base64
  const importPublicKey = async (keyData: string): Promise<CryptoKey> => {
    try {
      const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
      return window.crypto.subtle.importKey(
        'raw',
        binaryKey,
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        true,
        []
      );
    } catch (error) {
      console.error('Failed to import public key:', error);
      throw new Error('Public key import failed');
    }
  };

  // Verify certificate
  const verifyCertificate = async (cert: Certificate): Promise<boolean> => {
    try {
      return await certificateManager.verifyCertificate(cert);
    } catch (error) {
      console.error('Certificate verification failed:', error);
      return false;
    }
  };

  // Reset the crypto context
  const reset = () => {
    // Secure cleanup
    secureWipe(keyPair);
    secureWipe(signingKeyPair);
    secureWipe(certificate);
    
    setKeyPair(null);
    setSigningKeyPair(null);
    setCertificate(null);
    setSharedSecret(null);
    certificateManager.reset();
    ForwardSecrecy.resetCounter();
  };

  return (
    <CryptoContext.Provider
      value={{
        keyPair,
        signingKeyPair,
        certificate,
        sharedSecret,
        isInitializing,
        generateKeyPair,
        generateSigningKeyPair,
        generateCertificate,
        generatePairingCode,
        encryptMessage,
        decryptMessage,
        signMessage,
        verifyMessage,
        exportPublicKey,
        importPublicKey,
        verifyCertificate,
        reset
      }}
    >
      {children}
    </CryptoContext.Provider>
  );
};