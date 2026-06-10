import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, TextInput, ScrollView, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet,
} from 'react-native';
import { snappyAPI } from '../api/client';

// Snappy — in-app assistant for the provider app. Floating mascot launcher +
// a bottom-sheet chat. Runs against /snappy/provider-chat, which answers with
// the authenticated provider's own schedule/app context and escalates to the
// SNAP team when it can't help. Friendly-professional, no emoji in copy.

const MASCOT = require('../../assets/snappy-mascot.png');
const GREETING = {
  role: 'assistant',
  content:
    "Hi, I'm Snappy. Ask me about your schedule, how something in the app works, " +
    "or anything SNAP. If I can't help, I'll flag it for the team.",
};

export default function SnappyChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      // Skip the local greeting; send only real user/assistant turns.
      const history = next.filter((m, i) => !(i === 0 && m === GREETING));
      const res = await snappyAPI.chat(history);
      const reply = res?.data?.reply || "I'm not sure how to help with that.";
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Sorry, I hit a problem. You can reach the SNAP team at matt@snapmedical.app.',
      }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }
  }

  return (
    <>
      {/* Floating launcher — the mascot in the corner */}
      <TouchableOpacity
        style={styles.launcher}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        accessibilityLabel="Open Snappy assistant"
      >
        <Image source={MASCOT} style={styles.launcherImg} resizeMode="contain" />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheet}
          >
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Image source={MASCOT} style={styles.headerMascot} resizeMode="contain" />
                <View>
                  <Text style={styles.headerTitle}>Snappy</Text>
                  <Text style={styles.headerSub}>SNAP assistant</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={scrollRef}
              style={styles.body}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.map((m, i) => (
                <View key={i} style={[styles.msgRow, { justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }]}>
                  <View style={[styles.msg, m.role === 'user' ? styles.msgUser : styles.msgBot]}>
                    <Text style={m.role === 'user' ? styles.msgUserText : styles.msgBotText}>{m.content}</Text>
                  </View>
                </View>
              ))}
              {sending && (
                <View style={[styles.msgRow, { justifyContent: 'flex-start' }]}>
                  <View style={[styles.msg, styles.msgBot]}>
                    <ActivityIndicator color="#2563EB" />
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="Ask Snappy…"
                placeholderTextColor="#94A3B8"
                multiline
              />
              <TouchableOpacity
                style={[styles.send, (!input.trim() || sending) && { opacity: 0.5 }]}
                onPress={send}
                disabled={!input.trim() || sending}
              >
                <Text style={styles.sendText}>Send</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: 'absolute', right: 18, bottom: 24, width: 64, height: 64, zIndex: 50,
    shadowColor: '#0F172A', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  launcherImg: { width: 64, height: 64 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'flex-end' },
  sheet: { height: '82%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  header: {
    backgroundColor: '#2563EB', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerMascot: { width: 36, height: 36 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 11 },
  close: { color: '#fff', fontSize: 20, paddingHorizontal: 4 },
  body: { flex: 1, backgroundColor: '#F8FAFC' },
  msgRow: { flexDirection: 'row' },
  msg: { maxWidth: '82%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14 },
  msgUser: { backgroundColor: '#2563EB', borderBottomRightRadius: 4 },
  msgBot: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderBottomLeftRadius: 4 },
  msgUserText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  msgBotText: { color: '#0F172A', fontSize: 14, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10,
    borderTopWidth: 1, borderTopColor: '#F1F5F9', backgroundColor: '#fff',
  },
  input: {
    flex: 1, maxHeight: 100, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: '#0F172A',
  },
  send: { backgroundColor: '#2563EB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
