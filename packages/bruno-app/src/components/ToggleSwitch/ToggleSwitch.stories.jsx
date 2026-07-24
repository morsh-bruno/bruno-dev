import React, { useState } from 'react';
import { useArgs } from 'storybook/preview-api';
import ToggleSwitch from './index';

export default {
  title: 'Components/ToggleSwitch',
  component: ToggleSwitch,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  argTypes: {
    isOn: {
      control: 'boolean',
      description: 'Whether the switch is in the on state (controlled)'
    },
    size: {
      control: 'select',
      options: ['2xs', 'xs', 's', 'm', 'l', 'xl', '2xl'],
      description: 'The size of the switch'
    },
    activeColor: {
      control: 'color',
      description: 'Color of the track when on (defaults to the theme primary color)'
    },
    handleToggle: { action: 'toggled' }
  }
};

/**
 * ToggleSwitch is controlled — it renders `isOn` and reports intent through `handleToggle`,
 * but never holds its own state. Stories that need a working toggle wrap it and own the state.
 */
const Controlled = ({ isOn: initialOn = false, ...props }) => {
  const [isOn, setIsOn] = useState(initialOn);
  return <ToggleSwitch {...props} isOn={isOn} handleToggle={() => setIsOn((prev) => !prev)} />;
};

export const Playground = {
  render: (args) => {
    // Drive the switch straight from args so every control (isOn, size, activeColor) is live;
    // useArgs lets a click write isOn back to the control panel instead of into shadow state.
    const [{ isOn }, updateArgs] = useArgs();
    return <ToggleSwitch {...args} isOn={isOn} handleToggle={() => updateArgs({ isOn: !isOn })} />;
  },
  args: {
    isOn: true,
    size: 'm'
  }
};

export const States = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: 'flex', gap: '48px', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 600 }}>Off</span>
        <ToggleSwitch isOn={false} handleToggle={() => {}} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 600 }}>On</span>
        <ToggleSwitch isOn={true} handleToggle={() => {}} />
      </div>
    </div>
  )
};

export const Sizes = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
      {['2xs', 'xs', 's', 'm', 'l', 'xl', '2xl'].map((size) => (
        <div key={size} style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{size}</span>
          <Controlled size={size} isOn={true} />
        </div>
      ))}
    </div>
  )
};

export const CustomActiveColor = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
      <Controlled isOn={true} activeColor="#16a34a" />
      <Controlled isOn={true} activeColor="#dc2626" />
      <Controlled isOn={true} activeColor="#9333ea" />
    </div>
  )
};
